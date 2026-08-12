import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

export const maxDuration = 300;

/** POST /api/automations/[id]/run — exécute l'automatisation immédiatement. */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');

  const auto = await db.automation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!auto) return ok({ error: 'Automatisation introuvable.' }, { status: 404 });

  const result = await AutomationEngine.runById(auto.id);
  if (!result.ok) return ok({ error: result.error ?? 'Exécution échouée.' }, { status: 422 });
  return ok({ runId: result.runId, pendingApproval: (result as { pendingApproval?: boolean }).pendingApproval ?? false });
});
