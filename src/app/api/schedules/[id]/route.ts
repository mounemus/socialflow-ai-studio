import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveScheduleContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

const patchSchema = z.object({
  scheduledFor: z.string().datetime().optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, schedule } = await resolveScheduleContext(id);
  requirePermission(role, 'post.edit');
  const body = patchSchema.parse(await req.json());

  if (schedule.status === 'PUBLISHED') {
    throw new ForbiddenError('Cannot reschedule a published post');
  }

  const updated = await db.postSchedule.update({
    where: { id },
    data: {
      ...(body.scheduledFor ? { scheduledFor: new Date(body.scheduledFor) } : {}),
    },
  });
  return ok(updated);
});

const ACTIVE_SCHEDULE_STATUSES = ['SCHEDULED', 'QUEUED', 'PUBLISHING', 'UPLOADING', 'PROCESSING'] as const;

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role, schedule } = await resolveScheduleContext(id);
  requirePermission(role, 'post.edit');
  if (
    schedule.status === 'PUBLISHED' ||
    schedule.status === 'PUBLISHING' ||
    schedule.status === 'PROCESSING'
  ) {
    throw new ForbiddenError(
      'Ce créneau est publié ou en cours de publication — il ne peut pas être supprimé.',
    );
  }

  await db.$transaction(async (tx) => {
    await tx.postSchedule.delete({ where: { id } });

    const remainingActive = await tx.postSchedule.count({
      where: { postId: schedule.postId, status: { in: [...ACTIVE_SCHEDULE_STATUSES] } },
    });

    if (remainingActive === 0 && (schedule.post.status === 'SCHEDULED' || schedule.post.status === 'QUEUED')) {
      await tx.post.update({ where: { id: schedule.postId }, data: { status: 'APPROVED' } });
    }
  });

  return ok({ deleted: true });
});
