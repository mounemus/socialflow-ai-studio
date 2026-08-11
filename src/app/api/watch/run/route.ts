import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { IntelligentWatchService } from '@/services/watch/IntelligentWatchService';

const schema = z.object({ kind: z.enum(['MARKET', 'COMPETITION', 'PRICING']) });

export const maxDuration = 120;

/** POST /api/watch/run — lance une veille IA (marché / concurrence / prix) pour la marque active. */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { kind } = schema.parse(await req.json());

  const result = await IntelligentWatchService.runWatch(ctx.organizationId, kind);
  if (!result.ok) return ok({ error: result.reason }, { status: 422 });
  return ok({ reportId: result.reportId });
});
