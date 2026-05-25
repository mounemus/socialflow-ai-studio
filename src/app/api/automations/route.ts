import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const schema = z.object({
  brandId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  triggerType: z.string(),
  triggerConfig: z.record(z.unknown()).default({}),
  steps: z.array(z.object({ actionType: z.string(), config: z.record(z.unknown()).default({}) })).default([]),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const items = await db.automation.findMany({
    where: { organizationId: ctx.organizationId },
    include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { runs: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(items);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const body = schema.parse(await req.json());
  const auto = await db.automation.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      name: body.name,
      description: body.description,
      triggerType: body.triggerType as never,
      triggerConfig: body.triggerConfig as never,
      steps: {
        create: body.steps.map((s, i) => ({ order: i, actionType: s.actionType as never, config: s.config as never })),
      },
    },
    include: { steps: true },
  });
  return created(auto);
});
