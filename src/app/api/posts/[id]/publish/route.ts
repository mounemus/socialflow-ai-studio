import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';

const schema = z.object({ socialAccountId: z.string() });

/**
 * Immediate publish — creates a schedule with scheduledFor=now and publishes synchronously.
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, post } = await resolvePostContext(id);
  requirePermission(role, 'social.publish');
  const body = schema.parse(await req.json());

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
