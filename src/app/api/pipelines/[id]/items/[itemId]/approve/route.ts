import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

/** POST /api/pipelines/[id]/items/[itemId]/approve — validation humaine d'un item (Acte 3). */
export const POST = handle(async (_req, { params }) => {
  const { id, itemId } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'post.approve');
  const res = await BrandPipelineService.approveItem(id, itemId, userId);
  if (!res.success) throw new Error(res.reason ?? 'Validation impossible');
  return ok({ itemId, approved: true });
});
