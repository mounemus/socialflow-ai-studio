import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { WorkflowOrchestratorService } from '@/services/agent/WorkflowOrchestratorService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  prompt: z.string().min(10).max(2000),
  brandId: z.string().optional(),
});

/**
 * POST /api/agent/workflows/plan
 * Phrase → workflow proposé par Claude, persisté en DRAFT.
 * L'agent ne peut PAS activer le workflow — voir /activate (humain requis).
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const body = schema.parse(await req.json());
  const result = await WorkflowOrchestratorService.planWorkflowFromPrompt({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    brandId: body.brandId ?? null,
    prompt: body.prompt,
  });
  return ok(result);
});
