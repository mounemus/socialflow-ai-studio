import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { WorkflowOrchestratorService } from '@/services/agent/WorkflowOrchestratorService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/agent/workflows/audit
 * Détection des workflows inefficaces (métriques SQL déterministes,
 * commentaire Claude optionnel).
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const result = await WorkflowOrchestratorService.auditWorkflows({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  });
  return ok(result);
});
