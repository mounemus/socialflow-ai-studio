import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { OperatorAgent } from '@/services/agent/OperatorAgent';

export const POST = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const schedule = await import('@/lib/db').then((m) => m.db.agentSchedule.findUnique({ where: { id } }));
  if (!schedule || schedule.organizationId !== ctx.organizationId) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
  }
  const result = await OperatorAgent.runScheduleById(id, ctx.userId);
  return ok(result);
});
