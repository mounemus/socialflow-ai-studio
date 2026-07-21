import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';

export const dynamic = 'force-dynamic';

/**
 * GET   /api/agent/policy — politique + consommation du mois en cours
 * PATCH /api/agent/policy — modifier budget/interrupteur (org.manage)
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const [policy, budget] = await Promise.all([
    db.agentPolicy.findUnique({ where: { organizationId: ctx.organizationId } }).catch(() => null),
    AgentGuardrailService.checkBudget(ctx.organizationId),
  ]);
  return ok({
    policy: policy ?? {
      organizationId: ctx.organizationId,
      monthlyCostCentsLimit: AgentGuardrailService.defaultLimitCents(),
      enabled: true,
      isDefault: true,
    },
    budget,
  });
});

const patchSchema = z.object({
  monthlyCostCentsLimit: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');
  const body = patchSchema.parse(await req.json());
  const policy = await db.agentPolicy.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, ...body },
    update: body,
  });
  return ok(policy);
});
