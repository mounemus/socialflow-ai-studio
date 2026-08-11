import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { IntelligentWatchService } from '@/services/watch/IntelligentWatchService';

const schema = z.object({
  items: z.array(z.string().min(3).max(500)).min(1).max(12),
  competitorId: z.string().optional(),
});

export const maxDuration = 120;

/** POST /api/watch/proposal — proposition stratégique sur mesure depuis les recommandations retenues (mémorisées pour l'auto-apprentissage). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = schema.parse(await req.json());

  const result = await IntelligentWatchService.generateProposal(ctx.organizationId, body.items, {
    competitorId: body.competitorId,
  });
  if (!result.ok) return ok({ error: result.reason }, { status: 422 });
  return ok({ reportId: result.reportId });
});
