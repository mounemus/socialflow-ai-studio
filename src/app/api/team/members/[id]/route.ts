import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ForbiddenError, NotFoundError } from '@/lib/errors';

const patchSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']),
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');
  const body = patchSchema.parse(await req.json());

  const target = await db.teamMember.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!target) throw new NotFoundError('Member not found');
  if (target.userId === ctx.userId && body.role !== 'OWNER') {
    throw new ForbiddenError('Cannot demote yourself — ask another OWNER first');
  }

  const updated = await db.teamMember.update({ where: { id }, data: { role: body.role } });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');

  const target = await db.teamMember.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!target) throw new NotFoundError('Member not found');
  if (target.userId === ctx.userId) {
    throw new ForbiddenError('Cannot remove yourself');
  }
  if (target.role === 'OWNER') {
    const ownerCount = await db.teamMember.count({
      where: { organizationId: ctx.organizationId, role: 'OWNER' },
    });
    if (ownerCount <= 1) throw new ForbiddenError('Cannot remove the last OWNER');
  }

  await db.teamMember.delete({ where: { id } });
  return ok({ removed: true });
});
