/**
 * PerformanceRecommendationService — recommandations fondées sur les
 * PERFORMANCES RÉELLES (PostAnalytics), jamais sur des chiffres inventés.
 *
 * Les métriques sont calculées en SQL déterministe; Claude n'ajoute qu'une
 * narration actionnable (optionnelle, marquée mocked si IA indisponible).
 * Sans données réelles → réponse honnête "pas encore de données".
 */
import { db } from '@/lib/db';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';

export interface PerfRecommendations {
  hasData: boolean;
  window: { days: number; samples: number };
  byPlatform: { platform: string; posts: number; avgEngagementRate: number | null; impressions: number }[];
  bestHours: { hour: number; avgEngagementRate: number }[];
  topPosts: { postId: string; title: string | null; engagementRate: number | null; impressions: number }[];
  flopPosts: { postId: string; title: string | null; engagementRate: number | null; impressions: number }[];
  narrative: string | null;
  mocked: boolean;
}

export const PerformanceRecommendationService = {
  async computeFor(organizationId: string, brandId?: string | null, days = 30): Promise<PerfRecommendations> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const analytics = await db.postAnalytics.findMany({
      where: {
        capturedAt: { gte: since },
        post: { organizationId, ...(brandId ? { brandId } : {}) },
      },
      include: {
        post: { select: { id: true, title: true } },
        postSchedule: { select: { publishedAt: true } },
        socialAccount: { select: { platform: true } },
      },
      take: 500,
    });

    if (analytics.length === 0) {
      return {
        hasData: false,
        window: { days, samples: 0 },
        byPlatform: [],
        bestHours: [],
        topPosts: [],
        flopPosts: [],
        narrative: null,
        mocked: false,
      };
    }

    // Par plateforme
    const platMap = new Map<string, { posts: number; er: number[]; impressions: number }>();
    for (const a of analytics) {
      const p = a.socialAccount?.platform ?? 'INCONNU';
      const bucket = platMap.get(p) ?? { posts: 0, er: [], impressions: 0 };
      bucket.posts++;
      bucket.impressions += a.impressions;
      if (a.engagementRate != null) bucket.er.push(a.engagementRate);
      platMap.set(p, bucket);
    }
    const byPlatform = [...platMap.entries()].map(([platform, b]) => ({
      platform,
      posts: b.posts,
      avgEngagementRate: b.er.length ? b.er.reduce((s, v) => s + v, 0) / b.er.length : null,
      impressions: b.impressions,
    }));

    // Meilleures heures (heure locale du publishedAt)
    const hourMap = new Map<number, number[]>();
    for (const a of analytics) {
      const at = a.postSchedule?.publishedAt;
      if (!at || a.engagementRate == null) continue;
      const h = at.getHours();
      hourMap.set(h, [...(hourMap.get(h) ?? []), a.engagementRate]);
    }
    const bestHours = [...hourMap.entries()]
      .map(([hour, ers]) => ({ hour, avgEngagementRate: ers.reduce((s, v) => s + v, 0) / ers.length }))
      .sort((x, y) => y.avgEngagementRate - x.avgEngagementRate)
      .slice(0, 3);

    // Top / flop
    const ranked = analytics
      .filter((a) => a.engagementRate != null)
      .sort((x, y) => (y.engagementRate ?? 0) - (x.engagementRate ?? 0));
    const shape = (a: (typeof analytics)[number]) => ({
      postId: a.post.id,
      title: a.post.title,
      engagementRate: a.engagementRate,
      impressions: a.impressions,
    });
    const topPosts = ranked.slice(0, 3).map(shape);
    const flopPosts = ranked.slice(-3).reverse().map(shape);

    // Narration Claude (optionnelle + garde-fou budgétaire)
    let narrative: string | null = null;
    let mocked = false;
    const budget = await AgentGuardrailService.checkBudget(organizationId);
    if (budget.allowed) {
      const result = await AIRouterService.generateTextForTask('TEXT_LONGFORM', {
        systemPrompt:
          'Tu es analyste social media. À partir des métriques réelles ci-dessous, donne 3 à 5 recommandations concrètes et priorisées en français (quoi publier, où, quand, quoi arrêter). Pas de généralités.',
        prompt: JSON.stringify({ byPlatform, bestHours, topPosts, flopPosts }, null, 2),
        language: 'fr',
        temperature: 0.3,
        maxTokens: 600,
      });
      mocked = result.mocked;
      narrative = result.mocked ? null : result.text;
    } else {
      narrative = null;
    }

    // Journal de la décision/analyse (mémoire en DB).
    await db.agentRun
      .create({
        data: {
          organizationId,
          kind: 'OPERATOR',
          status: 'SUCCESS',
          title: `Recommandations performance${brandId ? ' (marque)' : ''}`,
          input: { brandId: brandId ?? null, days } as never,
          output: { byPlatform, bestHours, narrative, mocked, samples: analytics.length } as never,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);

    return {
      hasData: true,
      window: { days, samples: analytics.length },
      byPlatform,
      bestHours,
      topPosts,
      flopPosts,
      narrative,
      mocked,
    };
  },
};
