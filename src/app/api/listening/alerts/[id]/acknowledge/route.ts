import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export const POST = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;

  const alert = await db.mentionAlert.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!alert) throw new NotFoundError('Alert not found');

  await db.mentionAlert.update({
    where: { id: alert.id },
    data: { acknowledged: true, acknowledgedById: ctx.userId },
  });

  return ok({ id: alert.id, acknowledged: true });
});
