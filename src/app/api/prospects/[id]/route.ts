import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { NotFoundError } from '@/lib/errors';
import { db } from '@/lib/db';

const patchSchema = z.object({
  status: z.enum(['NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'DISCARDED']).optional(),
  notes: z.string().max(5000).optional(),
});

async function requireProspect(organizationId: string, id: string) {
  const prospect = await db.prospect.findFirst({ where: { id, organizationId } });
  if (!prospect) throw new NotFoundError('Prospect not found');
  return prospect;
}

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await requireProspect(ctx.organizationId, id);
  const body = patchSchema.parse(await req.json());
  const prospect = await db.prospect.update({ where: { id }, data: body });
  return ok(prospect);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await requireProspect(ctx.organizationId, id);
  await db.prospect.delete({ where: { id } });
  return ok({ deleted: true });
});
