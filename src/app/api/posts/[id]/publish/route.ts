import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';

const schema = z.object({ socialAccountId: z.string() });

/**
 * Immediate publish — creates a schedule with scheduledFor=now and publishes synchronously.
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.publish');
  const body = schema.parse(await req.json());

  const post = await db.post.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!post) throw new NotFoundError('Post not found');

  const schedule = await db.postSchedule.create({
    data: {
      postId: id,
      socialAccountId: body.socialAccountId,
      scheduledFor: new Date(),
    },
  });

  const result = await SocialPublisherService.publishNow({
    postId: id,
    scheduleId: schedule.id,
    socialAccountId: body.socialAccountId,
    body: post.body ?? '',
    hashtags: post.hashtags,
    mediaUrls: [],
  });

  return ok({ schedule, result });
});
