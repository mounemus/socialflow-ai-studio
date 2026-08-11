import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ProspectingService } from '@/services/prospecting/ProspectingService';

const estimateSchema = z.object({
  query: z.string().min(1).max(300),
  region: z.string().max(200).optional(),
  titles: z.array(z.string().max(80)).max(10).optional(),
  seniorities: z.array(z.string().max(30)).max(10).optional(),
  companySizes: z.array(z.string().max(20)).max(10).optional(),
  companyKeywords: z.array(z.string().max(60)).max(10).optional(),
});

export const maxDuration = 60;

/** POST /api/prospects/estimate — volume de leads LinkedIn correspondant aux filtres (gratuit, countOnly). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = estimateSchema.parse(await req.json());

  const result = await ProspectingService.estimate({
    organizationId: ctx.organizationId,
    query: body.query,
    region: body.region,
    titles: body.titles,
    seniorities: body.seniorities,
    companySizes: body.companySizes,
    companyKeywords: body.companyKeywords,
  });

  if (!result.ok) return ok({ error: result.reason }, { status: 422 });
  return ok({ count: result.count });
});
