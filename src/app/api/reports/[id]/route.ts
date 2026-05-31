import { handle, ok } from '@/lib/api';
import { resolveReportContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolveReportContext(id);
  const report = await db.report.findUnique({
    where: { id },
    include: { brand: { select: { id: true, name: true } } },
  });
  return ok(report);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolveReportContext(id);
  requirePermission(role, 'campaign.manage');
  await db.report.delete({ where: { id } });
  return ok({ deleted: true });
});
