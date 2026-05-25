import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { CompetitorAnalysisService } from '@/services/competitor/CompetitorAnalysisService';

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  const result = await CompetitorAnalysisService.analyze(id, ctx.organizationId);
  return ok(result);
});
