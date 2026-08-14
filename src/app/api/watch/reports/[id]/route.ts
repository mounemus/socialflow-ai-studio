import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

/** DELETE /api/watch/reports/[id] — supprime un rapport de veille. */
export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'watch.manage');
  await db.watchReport.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  return ok({ deleted: true });
});
