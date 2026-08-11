import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  website: z.string().max(500).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** PATCH /api/competitors/[id] — modifie un concurrent. */
export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'competitor.manage');
  const body = patchSchema.parse(await req.json());

  const existing = await db.competitor.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) return ok({ error: 'Concurrent introuvable.' }, { status: 404 });

  const updated = await db.competitor.update({ where: { id }, data: body });
  return ok(updated);
});

/** DELETE /api/competitors/[id] — supprime un concurrent (et ses rapports liés, en cascade). */
export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'competitor.manage');
  await db.competitor.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  return ok({ deleted: true });
});
