import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';
import { NotFoundError, ForbiddenError } from '@/lib/errors';

const schema = z.object({
  action: z.enum(['approve', 'reject', 'reset', 'execute']),
});

export const POST = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const body = schema.parse(await req.json());

  const item = await db.strategyItem.findUnique({
    where: { id },
    include: { strategy: true },
  });
  if (!item) throw new NotFoundError('Item not found');
  if (item.strategy.organizationId !== ctx.organizationId) throw new ForbiddenError();

  if (body.action === 'execute') {
    const result = await MarketingStrategyService.executeItem(id, ctx.organizationId, ctx.userId);
    return ok(result);
  }
  const statusMap = { approve: 'APPROVED', reject: 'REJECTED', reset: 'PROPOSED' } as const;
  const updated = await MarketingStrategyService.updateItemStatus(id, ctx.organizationId, statusMap[body.action]);
  return ok(updated);
});
