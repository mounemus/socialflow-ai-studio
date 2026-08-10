import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext, resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { ConcretizationService } from '@/services/concretization/ConcretizationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const schema = z.object({
  providerOverride: z.enum(['gemini', 'dalle', 'gpt-image', 'flux', 'claude', 'fal']).optional(),
});

export const POST = handle(async (req, { params }) => {
  const { id, itemId } = await params;

  const { organizationId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'campaign.manage');

  const itemCtx = await resolveStrategyItemContext(itemId);
  if (itemCtx.strategy.organizationId !== organizationId) {
    throw new ForbiddenError('Item does not belong to this pipeline organization');
  }

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});

  const result = await ConcretizationService.regenerateVisual({
    itemId,
    providerOverride: body.providerOverride,
  });
  return ok(result);
});
