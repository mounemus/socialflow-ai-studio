import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/workflows/[id]/activate
 * Activation HUMAINE d'un workflow proposé par l'agent (DRAFT → ACTIVE).
 * C'est le seul chemin vers ACTIVE pour un plan d'agent.
 */
export const POST = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const { id } = await params;
  const automation = await db.automation.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!automation) throw new NotFoundError('Workflow introuvable');
  const updated = await db.automation.update({
    where: { id: automation.id },
    data: { status: 'ACTIVE' },
  });
  await db.auditLog
    .create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'automation.activate',
        resource: 'Automation',
        resourceId: automation.id,
        metadata: { name: automation.name, proposedByAgent: true } as never,
      },
    })
    .catch(() => undefined);
  return ok({ id: updated.id, status: updated.status });
});
