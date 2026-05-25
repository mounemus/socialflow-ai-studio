/**
 * MarketingWatchService — orchestrates trend/keyword/hashtag/RSS watches.
 *
 * MVP capabilities (no paid API needed):
 *   - RSS parsing (rss-parser)
 *   - Google Trends scraping via public RSS endpoint (best-effort, may rate-limit)
 *
 * Future paid integrations (documented in API_LIMITS.md):
 *   - TikTok Creative Center API (requires partner agreement)
 *   - Instagram hashtag search (Business API, limited to 30 hashtags / 7-day window)
 *   - Reddit (works with OAuth, has free tier)
 */
import Parser from 'rss-parser';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { TrendWatch } from '@prisma/client';

const parser = new Parser({ timeout: 10000 });

export interface TrendItemInput {
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  publishedAt?: Date;
  rawData?: Record<string, unknown>;
}

export const MarketingWatchService = {
  /**
   * Score a trend item with simple heuristics (length, recency, keyword match).
   * Replace with embedding-based relevance once we wire a vector DB.
   */
  scoreItem(item: TrendItemInput, keywords: string[] = []) {
    const lower = `${item.title} ${item.summary ?? ''}`.toLowerCase();
    const keywordHits = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
    const relevanceScore = Math.min(1, keywordHits / Math.max(1, keywords.length));

    const ageMs = item.publishedAt ? Date.now() - item.publishedAt.getTime() : 0;
    const recencyScore = item.publishedAt ? Math.max(0, 1 - ageMs / (7 * 86_400_000)) : 0.5;

    const lengthScore = Math.min(1, (item.summary?.length ?? item.title.length) / 400);
    const trendScore = recencyScore * 0.6 + relevanceScore * 0.4;
    const viralScore = Math.min(1, recencyScore * 0.5 + lengthScore * 0.5);
    const competitionScore = Math.max(0.1, 1 - relevanceScore); // proxy
    const urgencyScore = recencyScore;
    const contentOpportunityScore = (trendScore + relevanceScore) / 2;
    return {
      trendScore,
      viralScore,
      competitionScore,
      relevanceScore,
      urgencyScore,
      contentOpportunityScore,
    };
  },

  async runRssWatch(watch: TrendWatch & { keywords?: string[] }): Promise<number> {
    const rssUrl = (watch.config as { rssUrl?: string })?.rssUrl ?? watch.query;
    if (!rssUrl) return 0;

    try {
      const feed = await parser.parseURL(rssUrl);
      const keywords = (watch.config as { keywords?: string[] })?.keywords ?? [];
      let inserted = 0;
      for (const entry of feed.items.slice(0, 50)) {
        const item: TrendItemInput = {
          title: entry.title ?? 'Untitled',
          summary: entry.contentSnippet ?? entry.content ?? '',
          url: entry.link,
          source: feed.title ?? rssUrl,
          publishedAt: entry.isoDate ? new Date(entry.isoDate) : undefined,
          rawData: { categories: entry.categories ?? [] },
        };
        const scores = this.scoreItem(item, keywords);
        await db.trendItem.create({
          data: {
            trendWatchId: watch.id,
            title: item.title,
            summary: item.summary,
            url: item.url,
            source: item.source,
            publishedAt: item.publishedAt,
            ...scores,
            rawData: (item.rawData ?? {}) as never,
          },
        });
        inserted++;
      }
      await db.trendWatch.update({
        where: { id: watch.id },
        data: { lastRunAt: new Date() },
      });
      return inserted;
    } catch (err) {
      logger.error('RSS watch failed', { watchId: watch.id, err: (err as Error).message });
      return 0;
    }
  },

  /**
   * Run ALL active watches for a given org. Worker calls this on a cron.
   */
  async runAllForOrg(organizationId: string): Promise<{ watchesRun: number; itemsInserted: number }> {
    const watches = await db.trendWatch.findMany({
      where: { organizationId, active: true },
    });
    let items = 0;
    for (const w of watches) {
      if (w.kind === 'RSS') items += await this.runRssWatch(w);
      // Other kinds: TODO real integrations
    }
    return { watchesRun: watches.length, itemsInserted: items };
  },
};
