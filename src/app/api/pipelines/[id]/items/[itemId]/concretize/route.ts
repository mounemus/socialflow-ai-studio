import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext, resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { ConcretizationService } from '@/services/concretization/ConcretizationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  forceProvider: z.enum(['gemini', 'dalle', 'flux', 'claude']).optional(),
});

export const POST = handle(async (req, { params }) => {
  const { id, itemId } = await params;

  // Auth via pipeline context (drives the org membership check)
  const { organizationId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'campaign.manage');

  // Verify the item belongs to a strategy attached to this pipeline's org
  const itemCtx = await resolveStrategyItemContext(itemId);
  if (itemCtx.strategy.organizationId !== organizationId) {
    throw new ForbiddenError('Item does not belong to this pipeline organization');
  }

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});

  const result = await ConcretizationService.concretizeItem({
    itemId,
    forceProvider: body.forceProvider,
  });
  if (!result) throw new NotFoundError('Concretization failed');
  return ok(result);
});
