import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';
import type { BrandProfileField } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pipelines/[id]/fields/[field]/approve — validation humaine d'un
 * champ du profil de marque (Acte 2).
 */
export const POST = handle(async (_req, { params }) => {
  const { id, field } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');
  const res = await BrandPipelineService.approveField(id, field as BrandProfileField, userId);
  if (!res.success) throw new Error(res.reason ?? 'Validation impossible');
  return ok({ field, approved: true });
});
