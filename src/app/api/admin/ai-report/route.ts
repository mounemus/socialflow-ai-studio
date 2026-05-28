import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { AIReliabilityService } from '@/services/ai/AIReliabilityService';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get('days') ?? '7', 10)));

  const [metrics, overview] = await Promise.all([
    AIReliabilityService.getMetrics(null, days),
    AIReliabilityService.getOverview(null, days),
  ]);

  return ok({
    availability: AIRouterService.availability(),
    routingPlans: AIRouterService.allPlans(),
    metrics: metrics.map((m) => ({
      ...m,
      score: AIReliabilityService.scoreProvider(m),
    })),
    overview,
  });
});
