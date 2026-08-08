import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { updateFlowInput } from '@/lib/contracts/flow';

export const dynamic = 'force-dynamic';

async function ownedFlow(id: string, organizationId: string) {
  const flow = await db.contentFlow.findFirst({ where: { id, organizationId } });
  if (!flow) throw new NotFoundError('Flow not found in this organization');
  return flow;
}

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  return ok(await ownedFlow(id, ctx.organizationId));
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');
  await ownedFlow(id, ctx.organizationId);
  const body = updateFlowInput.parse(await req.json());

  const flow = await db.contentFlow.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
      ...(body.graph ? { graph: body.graph as never } : {}),
    },
  });
  return ok(flow);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');
  await ownedFlow(id, ctx.organizationId);
  await db.contentFlow.delete({ where: { id } });
  return ok({ deleted: true });
});
