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

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role, schedule } = await resolveScheduleContext(id);
  requirePermission(role, 'post.edit');
  if (schedule.status === 'PUBLISHED' || schedule.status === 'PUBLISHING') {
    throw new ForbiddenError('Cannot delete a published/publishing schedule');
  }
  await db.postSchedule.delete({ where: { id } });
  return ok({ deleted: true });
});
