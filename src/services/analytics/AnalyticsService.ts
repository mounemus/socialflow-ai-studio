/**
 * AnalyticsService — aggregates KPIs for dashboard.
 * Falls back to deterministic mock data when real analytics tables are empty.
 */
import { db } from '@/lib/db';

export const AnalyticsService = {
  async overview(organizationId: string) {
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

  async byPlatform(organizationId: string) {
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
};
