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
  const item = await db.agentSchedule.update({
    where: { id },
    data: body,
  });
  return ok(item);
});

export const DELETE = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const { id } = await params;
  await db.agentSchedule.delete({ where: { id } });
  return ok({ deleted: true });
});
