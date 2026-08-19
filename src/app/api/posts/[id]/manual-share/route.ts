import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { assertPublishable, closePendingApprovals, orgRequiresApproval } from '@/lib/post-lifecycle';

const schema = z.object({
  sharedAt: z.string().datetime().optional(),
  channel: z.string().optional(),
});

/**
 * Mark every MANUAL-mode schedule attached to this post as shared.
 *   - sets PostSchedule.manualSharedAt + status = PUBLISHED
 *   - sets Post.status = PUBLISHED
 *   - writes an ApiLog entry tagged `manual-share`
 *
 * Body: { sharedAt?: ISO, channel?: string }
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, organizationId, post } = await resolvePostContext(id);
  // Même porte que /publish : publier (même à la main) exige le droit de
  // publier et respecte la validation optionnelle de l'organisation.
  requirePermission(role, 'social.publish');
  assertPublishable(post, await orgRequiresApproval(organizationId));

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});
  const sharedAt = body.sharedAt ? new Date(body.sharedAt) : new Date();

  const result = await db.postSchedule.updateMany({
    where: {
      postId: id,
      shareMode: 'MANUAL',
      status: { in: ['SCHEDULED', 'PUBLISHING', 'FAILED'] },
    },
    data: {
      manualSharedAt: sharedAt,
      status: 'PUBLISHED',
      publishedAt: sharedAt,
    },
  });

  await db.post.update({
    where: { id },
    data: { status: 'PUBLISHED' },
  });
  // Un post parti ferme ses demandes de validation — sinon « En attente » à vie.
  await closePendingApprovals(id);

  await db.apiLog.create({
    data: {
      organizationId,
      platform: body.channel ?? null,
      endpoint: `/api/posts/${id}/manual-share`,
      method: 'POST',
      statusCode: 200,
      requestBody: { sharedAt: sharedAt.toISOString(), channel: body.channel } as never,
      responseBody: { updated: result.count } as never,
    },
  });

  return ok({
    updated: result.count,
    sharedAt: sharedAt.toISOString(),
    channel: body.channel ?? null,
  });
});
