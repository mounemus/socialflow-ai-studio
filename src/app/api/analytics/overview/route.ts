import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const [overview, byPlatform, timeseries] = await Promise.all([
    AnalyticsService.overview(ctx.organizationId),
    AnalyticsService.byPlatform(ctx.organizationId),
    AnalyticsService.timeseries(ctx.organizationId, 30),
  ]);
  return ok({ overview, byPlatform, timeseries });
});
