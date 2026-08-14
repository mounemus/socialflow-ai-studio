import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { BrandPipelineService, BRAND_PROFILE_FIELDS } from '@/services/pipeline/BrandPipelineService';
import type { BrandProfileField } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pipelines/[id]/fields/[field]/approve — validation humaine d'un
 * champ du profil de marque (Acte 2).
 *
 * PERSISTE la valeur validée dans BrandProfile (approveProfileField), pas
 * seulement dans le JSON du run : avant, aucun champ validé n'atteignait la
 * base — la stratégie et les contenus étaient générés depuis un profil VIDE.
 */
export const POST = handle(async (_req, { params }) => {
  const { id, field } = await params;
  const { role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');
  if (!BRAND_PROFILE_FIELDS.includes(field as BrandProfileField)) {
    throw new ValidationError(`Champ inconnu : ${field}`);
  }
  const run = await db.brandPipelineRun.findUnique({
    where: { id },
    select: { fieldStates: true },
  });
  const states = (run?.fieldStates ?? {}) as Record<string, { value?: unknown }>;
  const value = states[field]?.value ?? null;
  const res = await BrandPipelineService.approveProfileField(id, field as BrandProfileField, value);
  if (!res.success) throw new ValidationError(res.reason ?? 'Validation impossible');
  return ok({ field, approved: true, persisted: true });
});
