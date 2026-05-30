import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { userId, organizationId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');
  const result = await BrandPipelineService.advance(id, organizationId, userId);
  return ok(result);
});
