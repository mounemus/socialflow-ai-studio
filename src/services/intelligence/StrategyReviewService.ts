/**
 * StrategyReviewService — weekly self-improving loop.
 *
 * For each active brand strategy:
 *   1. collect last 7 days of activity (executed items, scores, analytics)
 *   2. ask Claude to identify what's working, what's not, what to adjust
 *   3. write a "review note" + 1-3 concrete adjustment proposals
 *   4. persist as a StrategyReview record on the strategy metadata
 *
 * Triggered by Vercel Cron (weekly) or manual button.
 */
import { AIRouterService } from '@/services/ai/AIRouterService';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface StrategyReview {
  strategyId: string;
  reviewedAt: string;
  windowDays: number;
  observations: string[];
  whatWorks: string[];
  whatStruggles: string[];
  proposals: Array<{
    title: string;
    rationale: string;
    impact: 'low' | 'medium' | 'high';
    effort: 'low' | 'medium' | 'high';
  }>;
  metrics: {
    itemsExecuted: number;
    avgScore: number | null;
    totalImpressions: number;
    totalEngagement: number;
  };
  mocked: boolean;
}

export const StrategyReviewService = {
  /**
   * Run a review for all active strategies in the system (cron entry).
   */
  async runAll(): Promise<{ reviewed: number; errors: number }> {
    const strategies = await db.marketingStrategy.findMany({
      where: { status: { in: ['DRAFT', 'VALIDATED', 'IN_EXECUTION'] } },
      take: 100,
    });
    let reviewed = 0;
    let errors = 0;
    for (const s of strategies) {
      try {
        await this.reviewOne(s.id);
        reviewed++;
      } catch (err) {
        errors++;
        logger.warn('Strategy review failed', { strategyId: s.id, err: (err as Error).message });
      }
    }
    return { reviewed, errors };
  },

  async reviewOne(strategyId: string): Promise<StrategyReview> {
    const strategy = await db.marketingStrategy.findUnique({
      where: { id: strategyId },
      include: {
        brand: { include: { profile: true } },
        items: true,
      },
    });
    if (!strategy) throw new Error('Strategy not found');

    const since = new Date();
    since.setDate(since.getDate() - 7);

    // Items executed in the window
    const executedItems = strategy.items.filter((i) => i.status === 'EXECUTED' && i.updatedAt >= since);
    const recentPosts = await db.post.findMany({
      where: {
        brandId: strategy.brandId,
        updatedAt: { gte: since },
        status: { in: ['PUBLISHED', 'SCHEDULED'] },
      },
      include: { analytics: true },
      take: 50,
    });

    // Aggregate metrics
    let totalImpressions = 0;
    let totalEngagement = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    for (const p of recentPosts) {
      for (const a of p.analytics) {
        totalImpressions += a.impressions;
        totalEngagement += (a.likes + a.comments * 3 + a.shares * 5);
      }
      const meta = (p.metadata as Record<string, unknown> | null) ?? {};
      const lastScore = (meta.lastScore as { overall?: number } | undefined)?.overall;
      if (typeof lastScore === 'number') { scoreSum += lastScore; scoreCount++; }
    }
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null;

    const metrics = {
      itemsExecuted: executedItems.length,
      avgScore,
      totalImpressions,
      totalEngagement,
    };

    const itemBlock = strategy.items.slice(0, 30).map((i) =>
      `- [${i.status}] ${i.kind}: ${i.title}${i.platform ? ` (${i.platform})` : ''}`
    ).join('\n');

    const systemPrompt = `Tu es un strategist de croissance senior. Tu fais une review hebdomadaire d'une stratégie marketing en cours.

Tu rends un JSON STRICTEMENT:
{
  "observations": ["3-5 faits objectifs sur la semaine"],
  "whatWorks": ["2-3 patterns positifs"],
  "whatStruggles": ["2-3 frictions/baisses"],
  "proposals": [
    { "title": "ajustement court", "rationale": "pourquoi", "impact": "low|medium|high", "effort": "low|medium|high" }
  ]
}

Sois concret, mesurable, actionnable. 1-3 propositions max — qualité > quantité.`;

    const userPrompt = `Marque: ${strategy.brand?.name ?? '(?)'}
Stratégie: ${strategy.title} (horizon: ${strategy.horizon})

=== ITEMS (extrait) ===
${itemBlock}

=== ACTIVITÉ 7 DERNIERS JOURS ===
- Items exécutés: ${metrics.itemsExecuted}
- Posts publiés/programmés: ${recentPosts.length}
- Impressions totales: ${metrics.totalImpressions}
- Engagement total (pondéré): ${metrics.totalEngagement}
- Score qualité moyen: ${avgScore ?? 'N/A'}/100

Fais la review.`;

    let parsed: Omit<StrategyReview, 'strategyId' | 'reviewedAt' | 'windowDays' | 'metrics' | 'mocked'> | null = null;
    let mocked = true;
    try {
      const result = await AIRouterService.generateTextForTask('TEXT_STRATEGIC', {
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 1500,
        temperature: 0.5,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
        mocked = result.mocked;
      }
    } catch (err) {
      logger.warn('Strategy review AI failed', { err: (err as Error).message });
    }

    if (!parsed) {
      parsed = {
        observations: [`${metrics.itemsExecuted} items exécutés cette semaine`, `Score qualité moyen ${avgScore ?? 'N/A'}/100`],
        whatWorks: metrics.itemsExecuted > 0 ? ['Exécution en cours'] : [],
        whatStruggles: metrics.itemsExecuted === 0 ? ['Aucune exécution cette semaine'] : [],
        proposals: metrics.itemsExecuted === 0
          ? [{ title: 'Débloquer les exécutions', rationale: 'Pas d\'item exécuté — friction probable', impact: 'high', effort: 'low' }]
          : [{ title: 'Continuer + mesurer scores', rationale: 'Routine en place', impact: 'medium', effort: 'low' }],
      };
    }

    const review: StrategyReview = {
      strategyId,
      reviewedAt: new Date().toISOString(),
      windowDays: 7,
      ...parsed,
      metrics,
      mocked,
    };

    // Persist on strategy metadata (strategy JSON column)
    const stratJson = (strategy.strategy as Record<string, unknown> | null) ?? {};
    const history = Array.isArray(stratJson._reviews) ? stratJson._reviews as unknown[] : [];
    history.push(review);
    await db.marketingStrategy.update({
      where: { id: strategyId },
      data: { strategy: { ...stratJson, _reviews: history.slice(-12), _latestReview: review } as never },
    });

    return review;
  },

  /**
   * Get latest review for a strategy.
   */
  async getLatest(strategyId: string): Promise<StrategyReview | null> {
    const s = await db.marketingStrategy.findUnique({ where: { id: strategyId } });
    if (!s) return null;
    const stratJson = (s.strategy as Record<string, unknown> | null) ?? {};
    return (stratJson._latestReview as StrategyReview | undefined) ?? null;
  },
};
