import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';
import { AnalyticsClient, type TimeseriesPoint } from './AnalyticsClient';
import { PerfRecoWidget } from '@/components/dashboard/PerfRecoWidget';

export const dynamic = 'force-dynamic';

const ALLOWED_PERIODS = [7, 30, 90] as const;

function parsePeriod(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (ALLOWED_PERIODS as readonly number[]).includes(n) ? n : 30;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; brandId?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const orgId = membership.organizationId;
  const sp = await searchParams;
  const period = parsePeriod(sp.period);

  // Brand list for the filter (scoped to the active org → multi-tenant safe).
  const brands = await db.brand.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  // Validate the requested brand belongs to this org before using it.
  // Sans paramètre d'URL explicite, la marque active du contexte global
  // (sélecteur de la Topbar) sert de défaut.
  const activeBrandId = await getActiveBrandId(orgId);
  const brandId =
    sp.brandId && brands.some((b) => b.id === sp.brandId)
      ? sp.brandId
      : activeBrandId;

  const [comparison, timeseries] = await Promise.all([
    AnalyticsService.networkComparison(orgId, brandId ?? undefined, period),
    AnalyticsService.networkTimeseries(orgId, period, brandId ?? undefined),
  ]);

  // Derive active platforms from the timeseries keys (one line per platform).
  const activePlatforms = Array.from(
    new Set(
      timeseries.flatMap((p: TimeseriesPoint) =>
        Object.keys(p).filter((k) => k !== 'date'),
      ),
    ),
  );

  // Top-level KPIs = sum across the compared rows for the selected period.
  const kpis = comparison.rows.reduce(
    (acc, r) => {
      acc.posts += r.posts;
      acc.impressions += r.impressions;
      acc.reach += r.reach;
      acc.engagement += r.engagement;
      return acc;
    },
    { posts: 0, impressions: 0, reach: 0, engagement: 0 },
  );

  return (
    <div className="space-y-6">
      <AnalyticsClient
        kpis={kpis}
        rows={comparison.rows}
        summary={{
          bestByEngagement: comparison.bestByEngagement,
          bestByReach: comparison.bestByReach,
          fastestGrowing: comparison.fastestGrowing,
        }}
        timeseries={timeseries}
        activePlatforms={activePlatforms}
        brands={brands}
        period={period}
        brandId={brandId}
      />
      {/* Couche IA : lecture des perfs réelles + recommandations actionnables. */}
      <PerfRecoWidget brandId={brandId} />
    </div>
  );
}
