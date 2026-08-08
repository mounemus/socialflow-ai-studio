import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { NextActionService } from '@/services/dashboard/NextActionService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const result = await NextActionService.computeFor(ctx.organizationId, activeBrandId);
  // Map service shape { recommended, others } → UI-expected shape { primary, secondary }
  // (NextActionCard.tsx destructures payload.data.primary; without this mapping the
  // card always sees primary=undefined and falls back to the "Tu es à jour" empty state.)
  return ok({
    primary: result.recommended,
    secondary: result.others,
    generatedAt: result.generatedAt,
    mocked: result.mocked,
  });
});
