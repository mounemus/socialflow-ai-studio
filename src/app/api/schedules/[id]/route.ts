import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError, ForbiddenError } from '@/lib/errors';

const patchSchema = z.object({
  scheduledFor: z.string().datetime().optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const schedule = await db.postSchedule.findUnique({
    where: { id },
    include: { post: true },
  });
  if (!schedule) throw new NotFoundError('Schedule not found');
  if (schedule.post.organizationId !== ctx.organizationId) {
    throw new ForbiddenError('Not your organization');
  }
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
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');
  const { id } = await params;

  const schedule = await db.postSchedule.findUnique({
    where: { id },
    include: { post: true },
  });
  if (!schedule) throw new NotFoundError('Schedule not found');
  if (schedule.post.organizationId !== ctx.organizationId) {
    throw new ForbiddenError('Not your organization');
  }
  if (schedule.status === 'PUBLISHED' || schedule.status === 'PUBLISHING') {
    throw new ForbiddenError('Cannot delete a published/publishing schedule');
  }

  await db.postSchedule.delete({ where: { id } });
  return ok({ deleted: true });
});
