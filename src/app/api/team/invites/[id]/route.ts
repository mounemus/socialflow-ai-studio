import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');

  const invite = await db.teamInvite.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!invite) throw new NotFoundError('Invite not found');

  await db.teamInvite.update({ where: { id }, data: { revokedAt: new Date() } });
  return ok({ revoked: true });
});
