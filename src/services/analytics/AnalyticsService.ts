/**
 * AnalyticsService — aggregates KPIs for dashboard.
 * Reads real aggregates from PostAnalytics; empty tables yield zeros
 * (the UI must label "pas encore de données", never fake numbers).
 */
import { db } from '@/lib/db';
import { cached } from '@/lib/cache';
import { logger } from '@/lib/logger';
import type { SocialPlatform } from '@prisma/client';

const PLATFORMS: SocialPlatform[] = [
  'INSTAGRAM',
  'FACEBOOK',
  'LINKEDIN',
  'TWITTER',
  'TIKTOK',
  'YOUTUBE',
  'PINTEREST',
];

export type NetworkComparisonRow = {
  platform: string;
  posts: number;
  impressions: number;
  reach: number;
  engagement: number;
  clicks: number;
  engagementRate: number; // %
  avgPerPost: number; // engagement / posts
  deltaVsPrev: number; // % change in engagement vs previous period (null-safe → 0)
};

export type NetworkComparison = {
  rows: NetworkComparisonRow[];
  bestByEngagement: string | null;
  bestByReach: string | null;
  fastestGrowing: string | null;
};

export type NetworkTimeseriesPoint = { date: string } & Record<string, number | string>;

/**
 * Résout la plateforme d'une ligne PostAnalytics/PostSchedule quelle que soit
 * la voie de publication : compte natif direct, ou via le schedule associé
 * (compte natif ou page sociale) — nécessaire car socialAccountId peut être
 * null (partage manuel / compte non mappé côté passerelle) sans que la
 * ligne doive pour autant devenir invisible.
 */
type PlatformLookup = {
  socialAccount?: { platform: string } | null;
  socialPage?: { platform: string } | null;
  postSchedule?: {
    socialAccount?: { platform: string } | null;
    socialPage?: { platform: string } | null;
  } | null;
};

function platformOf(r: PlatformLookup): string | undefined {
  return (
    r.socialAccount?.platform ??
    r.socialPage?.platform ??
    r.postSchedule?.socialAccount?.platform ??
    r.postSchedule?.socialPage?.platform ??
    undefined
  );
}

export const AnalyticsService = {
  /**
   * Org-wide KPI overview. Cached 120s per org (advisory, per-instance — see
   * src/lib/cache.ts). Key scoped to organizationId for tenant isolation.
   */
  overview(organizationId: string) {
    return cached(`analytics:${organizationId}:overview`, 120_000, () =>
      this._overviewUncached(organizationId),
    );
  },

  async _overviewUncached(organizationId: string) {
    const [posts, scheduled, published, failed] = await Promise.all([
      db.post.count({ where: { organizationId } }),
      db.postSchedule.count({ where: { post: { organizationId }, status: 'SCHEDULED' } }),
      db.postSchedule.count({ where: { post: { organizationId }, status: 'PUBLISHED' } }),
      db.postSchedule.count({ where: { post: { organizationId }, status: 'FAILED' } }),
    ]);

    const aggAnalytics = await db.postAnalytics.aggregate({
      where: { post: { organizationId } },
      _sum: { impressions: true, reach: true, likes: true, comments: true, shares: true, clicks: true },
      _avg: { engagementRate: true },
    });

    return {
      counts: { posts, scheduled, published, failed },
      totals: {
        impressions: aggAnalytics._sum.impressions ?? 0,
        reach: aggAnalytics._sum.reach ?? 0,
        likes: aggAnalytics._sum.likes ?? 0,
        comments: aggAnalytics._sum.comments ?? 0,
        shares: aggAnalytics._sum.shares ?? 0,
        clicks: aggAnalytics._sum.clicks ?? 0,
      },
      engagementRate: aggAnalytics._avg.engagementRate ?? 0,
    };
  },

  /**
   * Per-platform aggregates. Cached 120s per org (advisory, per-instance — see
   * src/lib/cache.ts). Key scoped to organizationId for tenant isolation.
   */
  byPlatform(organizationId: string) {
    return cached(`analytics:${organizationId}:byPlatform`, 120_000, () =>
      this._byPlatformUncached(organizationId),
    );
  },

  async _byPlatformUncached(organizationId: string) {
    const accounts = await db.socialAccount.findMany({
      where: { organizationId },
      include: { analytics: true },
    });
    const map: Record<string, { impressions: number; engagement: number; posts: number }> = {};
    for (const a of accounts) {
      const k = a.platform;
      map[k] ||= { impressions: 0, engagement: 0, posts: 0 };
      for (const an of a.analytics) {
        map[k].impressions += an.impressions;
        map[k].engagement += an.likes + an.comments + an.shares;
        map[k].posts += 1;
      }
    }
    return map;
  },

  async timeseries(organizationId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db.postAnalytics.findMany({
      where: { post: { organizationId }, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
    });
    const byDay = new Map<string, { impressions: number; engagement: number }>();
    for (const r of rows) {
      const day = r.capturedAt.toISOString().slice(0, 10);
      const v = byDay.get(day) ?? { impressions: 0, engagement: 0 };
      v.impressions += r.impressions;
      v.engagement += r.likes + r.comments + r.shares;
      byDay.set(day, v);
    }
    return Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v }));
  },

  /**
   * Per-platform side-by-side comparison over `days`, with deltas vs the
   * immediately preceding window of the same length. Cached 120s per
   * org+brand+days. Defensive: any failure returns an all-zero comparison so
   * the UI never crashes.
   */
  networkComparison(
    organizationId: string,
    brandId?: string,
    days = 30,
  ): Promise<NetworkComparison> {
    return cached(
      `analytics:${organizationId}:netcmp:${brandId ?? 'all'}:${days}`,
      120_000,
      () => this._networkComparisonUncached(organizationId, brandId, days),
    );
  },

  async _networkComparisonUncached(
    organizationId: string,
    brandId: string | undefined,
    days: number,
  ): Promise<NetworkComparison> {
    try {
      const now = Date.now();
      const since = new Date(now - days * 86_400_000);
      const prevSince = new Date(now - 2 * days * 86_400_000);

      const brandFilter = brandId ? { brandId } : {};
      // Scope via le post (organisation + marque), pas via socialAccount :
      // un PostSchedule/PostAnalytics sans socialAccountId (partage manuel,
      // compte non mappé côté passerelle) reste ainsi visible.
      const postFilter = { organizationId, ...brandFilter };
      const platformSelect = {
        socialAccount: { select: { platform: true } },
        postSchedule: {
          select: {
            socialAccount: { select: { platform: true } },
            socialPage: { select: { platform: true } },
          },
        },
      } as const;

      const [current, previous, publishedInPeriod] = await Promise.all([
        db.postAnalytics.findMany({
          where: { capturedAt: { gte: since }, post: postFilter },
          select: {
            impressions: true,
            reach: true,
            likes: true,
            comments: true,
            shares: true,
            clicks: true,
            engagementRate: true,
            ...platformSelect,
          },
        }),
        db.postAnalytics.findMany({
          where: { capturedAt: { gte: prevSince, lt: since }, post: postFilter },
          select: { likes: true, comments: true, shares: true, ...platformSelect },
        }),
        // Publications réelles de la période — comptées même avant que les
        // métriques (impressions/engagement...) n'aient été collectées.
        db.postSchedule.findMany({
          where: { status: 'PUBLISHED', publishedAt: { gte: since }, post: postFilter },
          select: {
            socialAccount: { select: { platform: true } },
            socialPage: { select: { platform: true } },
          },
        }),
      ]);

      type Acc = {
        impressions: number;
        reach: number;
        engagement: number;
        clicks: number;
        rateSum: number;
        rateCount: number;
      };
      const cur = new Map<string, Acc>();
      const prevEng = new Map<string, number>();
      const postsCount = new Map<string, number>();

      const blank = (): Acc => ({
        impressions: 0,
        reach: 0,
        engagement: 0,
        clicks: 0,
        rateSum: 0,
        rateCount: 0,
      });

      for (const r of current) {
        const platform = platformOf(r);
        if (!platform) continue;
        const a = cur.get(platform) ?? blank();
        a.impressions += r.impressions;
        a.reach += r.reach;
        a.engagement += r.likes + r.comments + r.shares;
        a.clicks += r.clicks;
        if (typeof r.engagementRate === 'number') {
          a.rateSum += r.engagementRate;
          a.rateCount += 1;
        }
        cur.set(platform, a);
      }

      for (const r of previous) {
        const platform = platformOf(r);
        if (!platform) continue;
        prevEng.set(platform, (prevEng.get(platform) ?? 0) + r.likes + r.comments + r.shares);
      }

      for (const s of publishedInPeriod) {
        const platform = platformOf(s);
        if (!platform) continue;
        postsCount.set(platform, (postsCount.get(platform) ?? 0) + 1);
      }

      // Build a row for every platform with a real publication or captured metrics.
      const rows: NetworkComparisonRow[] = [];
      for (const platform of PLATFORMS) {
        const posts = postsCount.get(platform) ?? 0;
        const a = cur.get(platform);
        if (posts === 0 && !a) continue;
        const engagement = a?.engagement ?? 0;
        const prev = prevEng.get(platform) ?? 0;
        const deltaVsPrev = prev > 0 ? ((engagement - prev) / prev) * 100 : engagement > 0 ? 100 : 0;
        // Prefer captured engagementRate avg; fall back to engagement/impressions.
        const engagementRate =
          a && a.rateCount > 0
            ? a.rateSum / a.rateCount
            : a && a.impressions > 0
              ? (engagement / a.impressions) * 100
              : 0;
        rows.push({
          platform,
          posts,
          impressions: a?.impressions ?? 0,
          reach: a?.reach ?? 0,
          engagement,
          clicks: a?.clicks ?? 0,
          engagementRate: Math.round(engagementRate * 100) / 100,
          avgPerPost: posts > 0 ? Math.round(engagement / posts) : 0,
          deltaVsPrev: Math.round(deltaVsPrev * 10) / 10,
        });
      }

      rows.sort((x, y) => y.engagement - x.engagement);

      const bestByEngagement =
        rows.length > 0
          ? rows.reduce((b, r) => (r.engagement > b.engagement ? r : b)).platform
          : null;
      const bestByReach =
        rows.length > 0 ? rows.reduce((b, r) => (r.reach > b.reach ? r : b)).platform : null;
      const fastestGrowing =
        rows.length > 0
          ? rows.reduce((b, r) => (r.deltaVsPrev > b.deltaVsPrev ? r : b)).platform
          : null;

      return { rows, bestByEngagement, bestByReach, fastestGrowing };
    } catch (err) {
      logger.warn('AnalyticsService: comparaison réseaux indisponible', {
        err: (err as Error).message,
      });
      return { rows: [], bestByEngagement: null, bestByReach: null, fastestGrowing: null };
    }
  },

  /**
   * Daily engagement per platform, shaped for a multi-line chart:
   *   [{ date: '2026-05-01', INSTAGRAM: 120, FACEBOOK: 80, ... }, ...]
   * One numeric key per platform that had activity. Cached 120s per
   * org+brand+days. Defensive: returns [] on failure.
   */
  networkTimeseries(
    organizationId: string,
    days = 30,
    brandId?: string,
  ): Promise<NetworkTimeseriesPoint[]> {
    return cached(
      `analytics:${organizationId}:netts:${brandId ?? 'all'}:${days}`,
      120_000,
      () => this._networkTimeseriesUncached(organizationId, days, brandId),
    );
  },

  async _networkTimeseriesUncached(
    organizationId: string,
    days: number,
    brandId: string | undefined,
  ): Promise<NetworkTimeseriesPoint[]> {
    try {
      const since = new Date(Date.now() - days * 86_400_000);
      const brandFilter = brandId ? { brandId } : {};

      // Scope via le post (voir _networkComparisonUncached) : pas de filtre
      // socialAccount obligatoire, sinon les lignes sans socialAccountId
      // (partage manuel / passerelle non mappée) disparaissent du graphique.
      const rows = await db.postAnalytics.findMany({
        where: { capturedAt: { gte: since }, post: { organizationId, ...brandFilter } },
        orderBy: { capturedAt: 'asc' },
        select: {
          capturedAt: true,
          likes: true,
          comments: true,
          shares: true,
          socialAccount: { select: { platform: true } },
          postSchedule: {
            select: {
              socialAccount: { select: { platform: true } },
              socialPage: { select: { platform: true } },
            },
          },
        },
      });

      // Pre-seed each day so the line chart has a continuous x-axis.
      const byDay = new Map<string, Record<string, number>>();
      const activePlatforms = new Set<string>();
      const now = new Date();
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        byDay.set(d.toISOString().slice(0, 10), {});
      }

      for (const r of rows) {
        const platform = platformOf(r);
        if (!platform) continue;
        const day = r.capturedAt.toISOString().slice(0, 10);
        const bucket = byDay.get(day);
        if (!bucket) continue;
        activePlatforms.add(platform);
        bucket[platform] = (bucket[platform] ?? 0) + r.likes + r.comments + r.shares;
      }

      return Array.from(byDay.entries()).map(([date, bucket]) => {
        const point: NetworkTimeseriesPoint = { date };
        for (const p of activePlatforms) point[p] = bucket[p] ?? 0;
        return point;
      });
    } catch (err) {
      logger.warn('AnalyticsService: timeseries réseau indisponible', {
        err: (err as Error).message,
      });
      return [];
    }
  },
};
