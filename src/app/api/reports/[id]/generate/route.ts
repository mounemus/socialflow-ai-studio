import { handle, ok } from '@/lib/api';
import { resolveReportContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ReportingService } from '@/services/reporting/ReportingService';

export const maxDuration = 60;

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolveReportContext(id);
  requirePermission(role, 'campaign.manage');

  const report = await ReportingService.generateReport(id);
  return ok(report);
});
