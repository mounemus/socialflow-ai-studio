import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';

const schema = z.object({
  extraInstruction: z.string().optional(),
});

export const maxDuration = 60;

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role } = await resolveStrategyItemContext(id);
  requirePermission(role, 'campaign.manage');
  const body = schema.parse(await req.json().catch(() => ({})));

  const result = await MarketingStrategyService.regenerateItem(id, organizationId, body.extraInstruction);
  return ok(result);
});
