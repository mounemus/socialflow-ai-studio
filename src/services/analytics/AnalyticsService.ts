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

      // Current + previous window analytics, joined to the social account for platform.
      const [current, previous] = await Promise.all([
        db.postAnalytics.findMany({
          where: {
            capturedAt: { gte: since },
            socialAccount: { organizationId, ...brandFilter },
          },
          select: {
            impressions: true,
            reach: true,
            likes: true,
            comments: true,
            shares: true,
            clicks: true,
            engagementRate: true,
            socialAccount: { select: { platform: true } },
          },
        }),
        db.postAnalytics.findMany({
          where: {
            capturedAt: { gte: prevSince, lt: since },
            socialAccount: { organizationId, ...brandFilter },
          },
          select: {
            likes: true,
            comments: true,
            shares: true,
            socialAccount: { select: { platform: true } },
          },
        }),
      ]);

      type Acc = {
        posts: number;
        impressions: number;
        reach: number;
        engagement: number;
        clicks: number;
        rateSum: number;
        rateCount: number;
      };
      const cur = new Map<string, Acc>();
      const prevEng = new Map<string, number>();

      const blank = (): Acc => ({
        posts: 0,
        impressions: 0,
        reach: 0,
        engagement: 0,
        clicks: 0,
        rateSum: 0,
        rateCount: 0,
      });

      for (const r of current) {
        const platform = r.socialAccount?.platform;
        if (!platform) continue;
        const a = cur.get(platform) ?? blank();
        a.posts += 1;
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
        const platform = r.socialAccount?.platform;
        if (!platform) continue;
        prevEng.set(platform, (prevEng.get(platform) ?? 0) + r.likes + r.comments + r.shares);
      }

      // Build a row for every platform that has current activity.
      const rows: NetworkComparisonRow[] = [];
      for (const platform of PLATFORMS) {
        const a = cur.get(platform);
        if (!a || a.posts === 0) continue;
        const prev = prevEng.get(platform) ?? 0;
        const deltaVsPrev =
          prev > 0 ? ((a.engagement - prev) / prev) * 100 : a.engagement > 0 ? 100 : 0;
        // Prefer captured engagementRate avg; fall back to engagement/impressions.
        const engagementRate =
          a.rateCount > 0
            ? a.rateSum / a.rateCount
            : a.impressions > 0
              ? (a.engagement / a.impressions) * 100
              : 0;
        rows.push({
          platform,
          posts: a.posts,
          impressions: a.impressions,
          reach: a.reach,
          engagement: a.engagement,
          clicks: a.clicks,
          engagementRate: Math.round(engagementRate * 100) / 100,
          avgPerPost: a.posts > 0 ? Math.round(a.engagement / a.posts) : 0,
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
    } catch {
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

      const rows = await db.postAnalytics.findMany({
        where: {
          capturedAt: { gte: since },
          socialAccount: { organizationId, ...brandFilter },
        },
        orderBy: { capturedAt: 'asc' },
        select: {
          capturedAt: true,
          likes: true,
          comments: true,
          shares: true,
          socialAccount: { select: { platform: true } },
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
        const platform = r.socialAccount?.platform;
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
