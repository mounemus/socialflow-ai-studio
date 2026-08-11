import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ProspectingService } from '@/services/prospecting/ProspectingService';

const searchSchema = z.object({
  query: z.string().min(1).max(300),
  region: z.string().max(200).optional(),
  brandId: z.string().optional(),
  max: z.number().int().min(1).max(20).optional(),
});

/** POST /api/prospects/search — Prospection intelligente (une requête ScrapeGraphAI). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = searchSchema.parse(await req.json());

  const result = await ProspectingService.search({
    organizationId: ctx.organizationId,
    brandId: body.brandId,
    query: body.query,
    region: body.region,
    max: body.max,
  });

  if (!result.available) {
    return ok({ error: result.reason }, { status: 422 });
  }
  return ok(result);
});
