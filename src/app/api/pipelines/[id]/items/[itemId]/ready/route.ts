import { handle, ok } from '@/lib/api';
import { resolvePipelineContext, resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { ConcretizationService } from '@/services/concretization/ConcretizationService';

export const dynamic = 'force-dynamic';

export const POST = handle(async (_req, { params }) => {
  const { id, itemId } = await params;

  const { userId, organizationId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'campaign.manage');

  const itemCtx = await resolveStrategyItemContext(itemId);
  if (itemCtx.strategy.organizationId !== organizationId) {
    throw new ForbiddenError('Item does not belong to this pipeline organization');
  }

  const payload = await ConcretizationService.markItemReady(itemId, userId);
  return ok({ itemId, ready: true, concretization: payload });
});
