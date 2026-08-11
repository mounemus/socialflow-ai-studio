import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { IntelligentWatchService } from '@/services/watch/IntelligentWatchService';

export const maxDuration = 120;

/** POST /api/competitors/[id]/analyze — analyse IA profonde (marketing, prix, messages, publications). */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  const result = await IntelligentWatchService.analyzeCompetitor(ctx.organizationId, id);
  if (!result.ok) return ok({ error: result.reason }, { status: 422 });
  return ok({ reportId: result.reportId });
});
