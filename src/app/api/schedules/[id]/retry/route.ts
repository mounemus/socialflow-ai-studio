import { handle, ok } from '@/lib/api';
import { resolveScheduleContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { SocialPublisherService, buildPublishInputFromSchedule } from '@/services/publisher/SocialPublisherService';
import { db } from '@/lib/db';

/**
 * « Republier » manuel — repasse le même chemin de publication que le cron
 * de rattrapage (/api/cron/publish-due) pour un schedule FAILED ou
 * ACTION_REQUIRED précis.
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role, schedule } = await resolveScheduleContext(id);
  requirePermission(role, 'post.edit');

  if (schedule.status !== 'FAILED' && schedule.status !== 'ACTION_REQUIRED') {
    throw new ForbiddenError('Only a FAILED or ACTION_REQUIRED schedule can be republished');
  }

  const input = await buildPublishInputFromSchedule(schedule);
  const result = await SocialPublisherService.publishNow(input);
  const updated = await db.postSchedule.findUnique({ where: { id } });

  return ok({ schedule: updated, result });
});
