import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { WorkflowOrchestratorService } from '@/services/agent/WorkflowOrchestratorService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/agent/runs/[id]/explain
 * Explication d'un échec d'AutomationRun + recommandation de fallback.
 * Les faits viennent de la DB; Claude n'apporte que l'analyse.
 */
export const POST = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const result = await WorkflowOrchestratorService.explainRunFailure({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    automationRunId: id,
  });
  return ok(result);
});
