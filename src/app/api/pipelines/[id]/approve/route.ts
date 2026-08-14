import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';
import { approveStepInput } from '@/lib/contracts';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const schema = approveStepInput;

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
    // approveAllProfileFields PERSISTE les valeurs validées dans BrandProfile
    // puis passe à GENERATE_STRATEGY. L'ancien approveProfile (legacy)
    // changeait seulement l'étape : le profil validé n'atteignait JAMAIS la
    // base et la stratégie se générait depuis un profil vide.
    const res = await BrandPipelineService.approveAllProfileFields(id);
    if (!res.success) throw new ForbiddenError(res.reason ?? 'Validation du profil impossible');
    await db.brandPipelineRun
      .update({ where: { id }, data: { approvedProfileById: userId } })
      .catch(() => undefined);
    result = { step: res.data!.run.step, status: res.data!.run.status, awaiting: null };
  } else if (stepName === 'VALIDATE_STRATEGY_ITEMS') {
    result = await BrandPipelineService.approveStrategy(id, userId);
    // La stratégie validée est marquée VALIDATED — sans quoi elle restait
    // « brouillon » et éligible à une réutilisation auto ambiguë.
    if (pipeline.strategyId) {
      await db.marketingStrategy
        .update({
          where: { id: pipeline.strategyId },
          data: { status: 'VALIDATED', validatedAt: new Date(), validatedById: userId },
        })
        .catch(() => undefined);
    }
  } else {
    throw new ForbiddenError(`Step ${stepName} is not an admin-gate step`);
  }
  return ok(result);
});
