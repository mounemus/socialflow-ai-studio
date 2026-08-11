import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { IntelligentWatchService } from '@/services/watch/IntelligentWatchService';

const schema = z.object({ url: z.string().min(4).max(500) });

export const maxDuration = 60;

/** POST /api/competitors/from-url — ajoute un concurrent depuis un simple lien (l'IA identifie l'entreprise). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'competitor.manage');
  const { url } = schema.parse(await req.json());

  const result = await IntelligentWatchService.addCompetitorFromUrl(ctx.organizationId, url);
  if (!result.ok) return ok({ error: result.reason }, { status: 422 });
  return ok({ competitorId: result.competitorId, name: result.name });
});
