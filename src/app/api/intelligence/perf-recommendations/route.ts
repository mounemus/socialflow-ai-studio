import { handle, ok } from '@/lib/api';
import { requireTenant, requireBrand } from '@/lib/tenant';
import { PerformanceRecommendationService } from '@/services/intelligence/PerformanceRecommendationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/intelligence/perf-recommendations?brandId=&days=
 * Recommandations fondées sur les performances réelles (PostAnalytics).
 */
export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const brandId = url.searchParams.get('brandId');
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days')) || 30));
  if (brandId) await requireBrand(ctx, brandId);
  const result = await PerformanceRecommendationService.computeFor(ctx.organizationId, brandId, days);
  return ok(result);
});
