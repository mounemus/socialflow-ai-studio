import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { OperatorAgent } from '@/services/agent/OperatorAgent';

const schema = z.object({
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  promptTemplate: z.string().min(10),
  enabled: z.boolean().default(true),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const list = await db.agentSchedule.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return ok(list);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const body = schema.parse(await req.json());
  const item = await db.agentSchedule.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name,
      cronExpression: body.cronExpression,
      promptTemplate: body.promptTemplate,
      enabled: body.enabled,
      nextRunAt: OperatorAgent.computeNextRun(body.cronExpression),
    },
  });
  return created(item);
});
