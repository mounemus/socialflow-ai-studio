import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';
import { ValidationError } from '@/lib/errors';
import type { BrandPipelineStep } from '@prisma/client';

export const dynamic = 'force-dynamic';

const schema = z.object({
  stepName: z.string().min(1),
  feedback: z.string().min(1),
});

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');
  const body = schema.parse(await req.json());

  // Chemin COMPLET de la machine à états (rewind + purge + régénération).
  // L'ancien appel 4-arguments tombait sur le chemin legacy : une note dans
  // adminNotes et RIEN d'autre — l'UI affichait « régénération en cours… »
  // alors que rien n'était archivé ni régénéré, run bloqué pour toujours.
  const result = await BrandPipelineService.rejectCurrentStep(
    id,
    body.stepName as BrandPipelineStep,
    body.feedback ?? '',
  );
  if (!result.success) {
    throw new ValidationError(result.reason ?? 'Rejet impossible sur cette étape.');
  }
  // Trace de l'auteur du refus (le chemin complet ne prend pas d'userId).
  await BrandPipelineService._appendTrace(id, {
    kind: 'FIELD_REJECTED',
    at: new Date().toISOString(),
    payload: { stepName: body.stepName, by: userId, feedback: body.feedback ?? '' },
  }).catch(() => undefined);
  return ok(result.data);
});
