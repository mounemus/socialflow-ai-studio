import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

const schema = z.object({
  stepName: z.enum(['VALIDATE_PROFILE', 'VALIDATE_STRATEGY_ITEMS']).optional(),
});

const ADMIN_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { userId, role, isSuperAdmin, pipeline } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');

  const effectiveRole = isSuperAdmin ? 'SUPER_ADMIN' : role;
  if (!ADMIN_ROLES.includes(effectiveRole as typeof ADMIN_ROLES[number])) {
    throw new ForbiddenError('Only OWNER/ADMIN/SUPER_ADMIN can approve pipeline steps');
  }

  const body = schema.parse(await req.json().catch(() => ({})));
  const stepName = body.stepName ?? pipeline.step;

  let result;
  if (stepName === 'VALIDATE_PROFILE') {
    result = await BrandPipelineService.approveProfile(id, userId);
  } else if (stepName === 'VALIDATE_STRATEGY_ITEMS') {
    result = await BrandPipelineService.approveStrategy(id, userId);
  } else {
    throw new ForbiddenError(`Step ${stepName} is not an admin-gate step`);
  }
  return ok(result);
});
