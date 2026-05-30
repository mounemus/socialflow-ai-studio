import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext, resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { db } from '@/lib/db';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const schema = z.object({
  action: z.enum(['share', 'schedule', 'publish']),
  scheduledFor: z.string().datetime().optional(),
  socialAccountId: z.string().optional(),
  channel: z.string().optional(),
});

/**
 * Dispatch a concretized item to the right downstream path:
 *   - share    : mark every MANUAL schedule as shared (+ flip the post to PUBLISHED)
 *   - schedule : create a PostSchedule for the post (requires scheduledFor)
 *   - publish  : run SocialPublisherService.publishNow synchronously
 *
 * Body: { action, scheduledFor?: ISO, socialAccountId?: string, channel?: string }
 */
export const POST = handle(async (req, { params }) => {
  const { id, itemId } = await params;

  const { organizationId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'post.edit');

  const itemCtx = await resolveStrategyItemContext(itemId);
  if (itemCtx.strategy.organizationId !== organizationId) {
    throw new ForbiddenError('Item does not belong to this pipeline organization');
  }
  if (!itemCtx.item.postId) {
    throw new NotFoundError('Item has no linked post yet — concretize it first');
  }
  const postId = itemCtx.item.postId;

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});

  // ============================================================
  // SHARE — mark every MANUAL schedule as shared + flip post status
  // ============================================================
  if (body.action === 'share') {
    const sharedAt = new Date();
    const updated = await db.postSchedule.updateMany({
      where: {
        postId,
        shareMode: 'MANUAL',
        status: { in: ['SCHEDULED', 'PUBLISHING', 'FAILED'] },
      },
      data: {
        manualSharedAt: sharedAt,
        status: 'PUBLISHED',
        publishedAt: sharedAt,
      },
    });
    await db.post.update({ where: { id: postId }, data: { status: 'PUBLISHED' } });

    // Persist on item.metadata
    const itemMeta = (itemCtx.item.metadata as Record<string, unknown> | null) ?? {};
    await db.strategyItem.update({
      where: { id: itemId },
      data: {
        metadata: {
          ...itemMeta,
          lastAction: { type: 'share', at: sharedAt.toISOString(), updated: updated.count, channel: body.channel ?? null },
        } as never,
      },
    });

    return ok({
      action: 'share',
      itemId,
      postId,
      updated: updated.count,
      sharedAt: sharedAt.toISOString(),
      channel: body.channel ?? null,
    });
  }

  // ============================================================
  // SCHEDULE — create a PostSchedule row
  // ============================================================
  if (body.action === 'schedule') {
    if (!body.scheduledFor) throw new ForbiddenError('scheduledFor is required when action=schedule');
    const scheduledFor = new Date(body.scheduledFor);

    // Validate the optional social account belongs to the same org
    if (body.socialAccountId) {
      const sa = await db.socialAccount.findFirst({
        where: { id: body.socialAccountId, organizationId },
      });
      if (!sa) throw new NotFoundError('Social account not found in this organization');
    }

    const schedule = await db.postSchedule.create({
      data: {
        postId,
        socialAccountId: body.socialAccountId ?? null,
        scheduledFor,
        status: 'SCHEDULED',
        shareMode: body.socialAccountId ? 'AUTO' : 'MANUAL',
      },
    });
    await db.post.update({
      where: { id: postId },
      data: { status: 'SCHEDULED' },
    });

    const itemMeta = (itemCtx.item.metadata as Record<string, unknown> | null) ?? {};
    await db.strategyItem.update({
      where: { id: itemId },
      data: {
        metadata: {
          ...itemMeta,
          lastAction: {
            type: 'schedule',
            at: new Date().toISOString(),
            scheduleId: schedule.id,
            scheduledFor: scheduledFor.toISOString(),
          },
        } as never,
      },
    });

    return ok({ action: 'schedule', itemId, postId, schedule });
  }

  // ============================================================
  // PUBLISH — fire SocialPublisherService.publishNow synchronously
  // ============================================================
  if (body.action === 'publish') {
    if (!body.socialAccountId) throw new ForbiddenError('socialAccountId is required when action=publish');

    const sa = await db.socialAccount.findFirst({
      where: { id: body.socialAccountId, organizationId },
    });
    if (!sa) throw new NotFoundError('Social account not found in this organization');

    const post = await db.post.findUnique({
      where: { id: postId },
      include: { media: { take: 10 } },
    });
    if (!post) throw new NotFoundError('Post not found');

    // Create a PostSchedule scaffold so publishNow has something durable to update
    const schedule = await db.postSchedule.create({
      data: {
        postId,
        socialAccountId: sa.id,
        scheduledFor: new Date(),
        status: 'PUBLISHING',
        shareMode: 'AUTO',
      },
    });

    const result = await SocialPublisherService.publishNow({
      postId,
      scheduleId: schedule.id,
      socialAccountId: sa.id,
      body: post.body ?? '',
      hashtags: post.hashtags ?? [],
      mediaUrls: post.media.map((m) => m.url),
      cta: post.cta ?? undefined,
      linkUrl: post.linkUrl ?? undefined,
    });

    const itemMeta = (itemCtx.item.metadata as Record<string, unknown> | null) ?? {};
    await db.strategyItem.update({
      where: { id: itemId },
      data: {
        metadata: {
          ...itemMeta,
          lastAction: {
            type: 'publish',
            at: new Date().toISOString(),
            scheduleId: schedule.id,
            success: result.success,
            externalPostId: result.externalPostId ?? null,
          },
        } as never,
      },
    });

    return ok({ action: 'publish', itemId, postId, scheduleId: schedule.id, result });
  }

  throw new ForbiddenError('Unknown action');
});
