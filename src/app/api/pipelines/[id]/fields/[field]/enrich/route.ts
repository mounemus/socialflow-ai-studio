import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';
import type { BrandProfileField } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/pipelines/[id]/fields/[field]/enrich — régénération IA d'un seul
 * champ du profil (Acte 2). Retourne aussi le drapeau mocked (honnêteté).
 */
export const POST = handle(async (_req, { params }) => {
  const { id, field } = await params;
  const { role } = await resolvePipelineContext(id);
  requirePermission(role, 'ai.use');
  const res = await BrandPipelineService.enrichField(id, field as BrandProfileField);
  if (!res.success) throw new Error(res.reason ?? 'Régénération impossible');
  return ok({ field, ...res.data });
});
