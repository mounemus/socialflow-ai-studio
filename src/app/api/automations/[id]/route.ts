import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT', 'ARCHIVED']).optional(),
  name: z.string().min(1).max(200).optional(),
});

/** PATCH /api/automations/[id] — active/pause/renomme une automatisation. */
export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = patchSchema.parse(await req.json());

  const existing = await db.automation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) return ok({ error: 'Automatisation introuvable.' }, { status: 404 });

  const updated = await db.automation.update({ where: { id }, data: body });
  return ok(updated);
});

/** DELETE /api/automations/[id] — supprime une automatisation (steps + runs en cascade). */
export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await db.automation.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  return ok({ deleted: true });
});
