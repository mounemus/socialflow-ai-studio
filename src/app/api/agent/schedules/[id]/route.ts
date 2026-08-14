import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().optional(),
  cronExpression: z.string().optional(),
  promptTemplate: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  // updateMany scopé org : sans ce filtre, un admin pouvait modifier la
  // planification d'une AUTRE organisation en devinant l'id (cross-tenant).
  const res = await db.agentSchedule.updateMany({
    where: { id, organizationId: ctx.organizationId },
    data: body,
  });
  if (res.count === 0) return ok(null);
  const item = await db.agentSchedule.findUnique({ where: { id } });
  return ok(item);
});

export const DELETE = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const { id } = await params;
  // deleteMany scopé org — même faille cross-tenant que le PATCH ci-dessus.
  const res = await db.agentSchedule.deleteMany({
    where: { id, organizationId: ctx.organizationId },
  });
  return ok({ deleted: res.count > 0 });
});
