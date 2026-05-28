import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';

const schema = z.object({
  extraInstruction: z.string().optional(),
});

export const maxDuration = 60;

export const POST = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const body = schema.parse(await req.json().catch(() => ({})));

  const result = await MarketingStrategyService.regenerateItem(id, ctx.organizationId, body.extraInstruction);
  return ok(result);
});
