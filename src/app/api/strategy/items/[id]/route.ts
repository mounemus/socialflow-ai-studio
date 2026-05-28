import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';
import { NotFoundError, ForbiddenError } from '@/lib/errors';

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reset', 'execute']),
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  platform: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  suggestedDate: z.string().nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().nullable().optional(),
});

export const POST = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const body = actionSchema.parse(await req.json());

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

/**
 * Edit item content inline (title, description, platform, etc.)
 */
export const PATCH = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const updated = await MarketingStrategyService.updateItemContent(id, ctx.organizationId, body);
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const item = await db.strategyItem.findUnique({ where: { id }, include: { strategy: true } });
  if (!item) throw new NotFoundError('Item not found');
  if (item.strategy.organizationId !== ctx.organizationId) throw new ForbiddenError();
  if (item.status === 'EXECUTED') throw new ForbiddenError('Cannot delete executed item');
  await db.strategyItem.delete({ where: { id } });
  return ok({ deleted: true });
});
