/**
 * CompetitorAnalysisService — pulls public posts (when feeds available) and runs SWOT via AI.
 *
 * NOTE: Most social platforms forbid scraping. For production:
 *   - Use approved Graph APIs (limited) OR
 *   - Use 3rd-party providers (RivalIQ, Brandwatch, Phyllo) under their licence.
 * MVP relies on user-provided RSS feeds + manual entries.
 */

import { db } from '@/lib/db';
import { AIProviderService } from '../ai/AIProviderService';

export const CompetitorAnalysisService = {
  async analyze(competitorId: string, organizationId: string) {
    const comp = await db.competitor.findFirst({
      where: { id: competitorId, organizationId },
      include: { posts: { orderBy: { postedAt: 'desc' }, take: 20 } },
    });
    if (!comp) throw new Error('Competitor not found');

    const swot = await AIProviderService.analyzeCompetitor({
      name: comp.name,
      posts: comp.posts.map((p) => p.caption ?? '').filter(Boolean).slice(0, 10),
    });

    await db.analyticsSnapshot.create({
      data: {
        organizationId,
        competitorId,
        scope: 'competitor',
        scopeId: competitorId,
        data: swot as never,
      },
    });

    return { competitor: comp, swot };
  },

  /**
   * Compute publication cadence over a window.
   */
  async cadence(competitorId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const posts = await db.competitorPost.findMany({
      where: { competitorId, postedAt: { gte: since } },
      orderBy: { postedAt: 'asc' },
    });
    const byPlatform: Record<string, number> = {};
    for (const p of posts) {
      byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
    }
    return { total: posts.length, perDay: posts.length / days, byPlatform };
  },
};
