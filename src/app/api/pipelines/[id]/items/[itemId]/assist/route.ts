import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext, resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { ConcretizationService } from '@/services/concretization/ConcretizationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ kind: z.enum(['caption', 'prompt']) });

/** POST /api/pipelines/[id]/items/[itemId]/assist — génération IA à la demande (caption ou prompt visuel). */
export const POST = handle(async (req, { params }) => {
  const { id, itemId } = await params;

  const { organizationId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'campaign.manage');

  const itemCtx = await resolveStrategyItemContext(itemId);
  if (itemCtx.strategy.organizationId !== organizationId) {
    throw new ForbiddenError('Item does not belong to this pipeline organization');
  }

  const body = schema.parse(await req.json());
  const result = await ConcretizationService.assist({ itemId, kind: body.kind });
  return ok(result);
});
