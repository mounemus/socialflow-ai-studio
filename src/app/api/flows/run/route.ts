import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { flowGraph } from '@/lib/contracts/flow';
import { FlowRunnerService } from '@/services/flow/FlowRunnerService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  graph: flowGraph,
  /** Flux enregistré à horodater après exécution (facultatif). */
  flowId: z.string().optional(),
});

/**
 * POST /api/flows/run — exécute un graphe et renvoie les sorties par nœud.
 * Le graphe est envoyé tel quel : on peut exécuter un brouillon non enregistré.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  const result = await FlowRunnerService.run({
    graph: body.graph,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  });

  if (body.flowId) {
    await db.contentFlow
      .updateMany({
        where: { id: body.flowId, organizationId: ctx.organizationId },
        data: { lastRunAt: new Date() },
      })
      .catch(() => {});
  }

  return ok(result);
});
