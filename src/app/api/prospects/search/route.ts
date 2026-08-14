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
  source: z.enum(['auto', 'linkedin', 'web', 'perplexity']).optional(),
  webQuery: z.string().max(300).optional(),
  titles: z.array(z.string().max(80)).max(10).optional(),
  seniorities: z.array(z.string().max(30)).max(10).optional(),
  companySizes: z.array(z.string().max(20)).max(10).optional(),
  companyKeywords: z.array(z.string().max(60)).max(10).optional(),
});

// Plan Vercel Pro : la chaîne LinkedIn (Apollo→Apify ~60s) + fallback web
// (Gemini + smartscraper par site) peut dépasser 120 s.
export const maxDuration = 300;

/** POST /api/prospects/search — Prospection intelligente (une requête ScrapeGraphAI, jusqu'à ~90 s). */
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
    source: body.source,
    webQuery: body.webQuery,
    titles: body.titles,
    seniorities: body.seniorities,
    companySizes: body.companySizes,
    companyKeywords: body.companyKeywords,
  });

  if (!result.available) {
    return ok({ error: result.reason }, { status: 422 });
  }
  return ok(result);
});
