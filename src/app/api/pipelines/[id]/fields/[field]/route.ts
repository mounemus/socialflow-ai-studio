import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';
import type { BrandProfileField } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

const schema = z.object({ value: z.unknown() });

/**
 * PATCH /api/pipelines/[id]/fields/[field] { value } — édition manuelle d'un
 * champ proposé par l'IA pendant l'Acte 2 (enrichissement).
 * (Route manquante à l'origine : l'UI recevait une page 404 HTML.)
 */
export const PATCH = handle(async (req, { params }) => {
  const { id, field } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');
  const body = schema.parse(await req.json());
  const res = await BrandPipelineService.editField(id, field as BrandProfileField, body.value, userId);
  if (!res.success) throw new Error(res.reason ?? 'Édition impossible');
  return ok({ field, saved: true });
});
