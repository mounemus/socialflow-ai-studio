import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { createFlowInput } from '@/lib/contracts/flow';

export const dynamic = 'force-dynamic';

/** GET /api/flows — les flux de l'organisation (les plus récents d'abord). */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const flows = await db.contentFlow.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true, brandId: true, lastRunAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return ok(flows);
});

/** POST /api/flows — enregistre un nouveau graphe. */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.create');
  const body = createFlowInput.parse(await req.json());

  const flow = await db.contentFlow.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      name: body.name,
      graph: body.graph as never,
    },
  });
  return created(flow);
});
