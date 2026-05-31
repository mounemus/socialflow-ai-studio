/**
 * ReportingService — assembles white-label performance reports for agency clients.
 *
 * Pipeline:
 *   1. resolvePeriod()      → turn a ReportPeriod (+ optional custom dates) into a window.
 *   2. gatherData()         → defensively aggregate KPIs from analytics tables.
 *   3. generateAiSummary()  → ask the AI router (TEXT_STRATEGIC = Claude) for a
 *                             client-facing executive summary in French.
 *   4. generateReport()     → orchestrate: GENERATING → READY | FAILED.
 *
 * DESIGN RULE: every method must return SOMETHING usable. Sub-queries are wrapped
 * with `safe()` so a single broken table never sinks the whole report. The only
 * exception thrown past the public boundary is "not found" (getOne / generateReport
 * with an unknown id).
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AIRouterService } from '@/services/ai/AIRouterService';
import type { Report, ReportPeriod, ReportFrequency, Prisma } from '@prisma/client';

// ============================================================================
// TYPES — the shape persisted into Report.data
// ============================================================================

export interface ReportDelta {
  impressions: number;
  engagement: number;
  reach: number;
  posts: number;
  /** signed percentage change vs the previous equal-length window, e.g. +12.5 */
  engagementRatePct: number;
}

export interface ReportOverview {
  totalPosts: number;
  totalImpressions: number;
  totalEngagement: number;
  totalReach: number;
  avgEngagementRate: number;
  deltaVsPrevious: ReportDelta;
}

export interface ReportEngagement {
  timeseries: Array<{ date: string; impressions: number; engagement: number }>;
  byType: { likes: number; comments: number; shares: number };
}

export interface ReportTopPost {
  title: string;
  format: string;
  platform: string;
  impressions: number;
  engagement: number;
  engagementRate: number;
  publishedAt: string | null;
}

export interface ReportPlatform {
  platform: string;
  posts: number;
  impressions: number;
  engagement: number;
  engagementRate: number;
}

export interface ReportCompetitor {
  name: string;
  posts: number;
  avgEngagement: number;
}

export interface ReportData {
  meta: {
    generatedAt: string;
    periodLabel: string;
    brandName: string;
    orgName: string;
  };
  overview: ReportOverview;
  engagement: ReportEngagement;
  topPosts: ReportTopPost[];
  platforms: ReportPlatform[];
  competitors?: ReportCompetitor[];
}

export interface ResolvedPeriod {
  start: Date;
  end: Date;
  label: string;
}

export interface GatherDataArgs {
  organizationId: string;
  brandId?: string | null;
  period: ReportPeriod;
  customStart?: Date | null;
  customEnd?: Date | null;
  sections?: string[];
}

// ============================================================================
// HELPERS
// ============================================================================

const DAY_MS = 86_400_000;

/** Run a query, never throw — log and return a fallback so the report keeps going. */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn('ReportingService safe() caught', { label, err: (err as Error).message });
    return fallback;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percentage change from `prev` to `curr`, guarded against division by zero. */
function pctChange(curr: number, prev: number): number {
  if (!prev) return curr > 0 ? 100 : 0;
  return round2(((curr - prev) / prev) * 100);
}

function engagementRate(engagement: number, impressions: number): number {
  if (!impressions) return 0;
  return round2((engagement / impressions) * 100);
}

const FR_PERIOD_LABEL: Record<ReportPeriod, string> = {
  LAST_7_DAYS: '7 derniers jours',
  LAST_30_DAYS: '30 derniers jours',
  LAST_90_DAYS: '90 derniers jours',
  LAST_12_MONTHS: '12 derniers mois',
  LAST_MONTH: 'Le mois dernier',
  LAST_QUARTER: 'Le trimestre dernier',
  CUSTOM: 'Période personnalisée',
};

// ============================================================================
// SERVICE
// ============================================================================

export const ReportingService = {
  /**
   * Turn a ReportPeriod (+ optional custom dates) into a concrete [start, end]
   * window with a human label. `end` is "now" for rolling windows.
   */
  resolvePeriod(period: ReportPeriod, customStart?: Date | null, customEnd?: Date | null): ResolvedPeriod {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    switch (period) {
      case 'LAST_7_DAYS':
        start = new Date(now.getTime() - 7 * DAY_MS);
        break;
      case 'LAST_30_DAYS':
        start = new Date(now.getTime() - 30 * DAY_MS);
        break;
      case 'LAST_90_DAYS':
        start = new Date(now.getTime() - 90 * DAY_MS);
        break;
      case 'LAST_MONTH': {
        // Full previous calendar month.
        const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(firstThisMonth.getTime() - 1);
        break;
      }
      case 'LAST_QUARTER':
        start = new Date(now.getTime() - 90 * DAY_MS);
        break;
      case 'LAST_12_MONTHS': {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 12);
        start = d;
        break;
      }
      case 'CUSTOM':
        start = customStart ?? new Date(now.getTime() - 30 * DAY_MS);
        end = customEnd ?? now;
        break;
      default:
        start = new Date(now.getTime() - 30 * DAY_MS);
    }

    const label =
      period === 'CUSTOM'
        ? `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`
        : FR_PERIOD_LABEL[period] ?? FR_PERIOD_LABEL.LAST_30_DAYS;

    return { start, end, label };
  },

  /**
   * Assemble the full report data object. Every section is wrapped in safe() so a
   * single failing table yields zeros instead of crashing the whole report.
   */
  async gatherData(args: GatherDataArgs): Promise<ReportData> {
    const { organizationId, brandId, period, customStart, customEnd } = args;
    const sections = args.sections ?? ['overview', 'engagement', 'top-posts', 'platforms'];
    const { start, end, label } = this.resolvePeriod(period, customStart, customEnd);

    // previous equal-length window, immediately preceding [start, end]
    const windowMs = Math.max(end.getTime() - start.getTime(), DAY_MS);
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - windowMs);

    // Scope filter: org + optional brand. Applied through the Post relation.
    const postWhere: Prisma.PostWhereInput = { organizationId };
    if (brandId) postWhere.brandId = brandId;
    const analyticsWhere = (from: Date, to: Date): Prisma.PostAnalyticsWhereInput => ({
      post: postWhere,
      capturedAt: { gte: from, lte: to },
    });

    // ---- meta ----------------------------------------------------------------
    const meta = await safe(
      'meta',
      async () => {
        const [org, brand] = await Promise.all([
          db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
          brandId ? db.brand.findUnique({ where: { id: brandId }, select: { name: true } }) : Promise.resolve(null),
        ]);
        return {
          generatedAt: new Date().toISOString(),
          periodLabel: label,
          brandName: brand?.name ?? 'Toutes les marques',
          orgName: org?.name ?? 'Organisation',
        };
      },
      {
        generatedAt: new Date().toISOString(),
        periodLabel: label,
        brandName: brandId ? 'Marque' : 'Toutes les marques',
        orgName: 'Organisation',
      },
    );

    // ---- overview (+ deltaVsPrevious) ---------------------------------------
    const overview = await safe<ReportOverview>(
      'overview',
      async () => {
        const aggFor = async (from: Date, to: Date) => {
          const [agg, posts] = await Promise.all([
            db.postAnalytics.aggregate({
              where: analyticsWhere(from, to),
              _sum: { impressions: true, reach: true, likes: true, comments: true, shares: true },
            }),
            db.post.count({ where: { ...postWhere, createdAt: { gte: from, lte: to } } }),
          ]);
          const impressions = agg._sum.impressions ?? 0;
          const reach = agg._sum.reach ?? 0;
          const engagement = (agg._sum.likes ?? 0) + (agg._sum.comments ?? 0) + (agg._sum.shares ?? 0);
          return { impressions, reach, engagement, posts };
        };

        const [cur, prev] = await Promise.all([aggFor(start, end), aggFor(prevStart, prevEnd)]);
        const avgRate = engagementRate(cur.engagement, cur.impressions);

        return {
          totalPosts: cur.posts,
          totalImpressions: cur.impressions,
          totalEngagement: cur.engagement,
          totalReach: cur.reach,
          avgEngagementRate: avgRate,
          deltaVsPrevious: {
            impressions: pctChange(cur.impressions, prev.impressions),
            engagement: pctChange(cur.engagement, prev.engagement),
            reach: pctChange(cur.reach, prev.reach),
            posts: pctChange(cur.posts, prev.posts),
            engagementRatePct: pctChange(avgRate, engagementRate(prev.engagement, prev.impressions)),
          },
        };
      },
      {
        totalPosts: 0,
        totalImpressions: 0,
        totalEngagement: 0,
        totalReach: 0,
        avgEngagementRate: 0,
        deltaVsPrevious: { impressions: 0, engagement: 0, reach: 0, posts: 0, engagementRatePct: 0 },
      },
    );

    // ---- engagement (timeseries + byType) -----------------------------------
    const engagement = await safe<ReportEngagement>(
      'engagement',
      async () => {
        const rows = await db.postAnalytics.findMany({
          where: analyticsWhere(start, end),
          orderBy: { capturedAt: 'asc' },
          select: { capturedAt: true, impressions: true, likes: true, comments: true, shares: true },
        });
        const byDay = new Map<string, { impressions: number; engagement: number }>();
        let likes = 0;
        let comments = 0;
        let shares = 0;
        for (const r of rows) {
          const day = r.capturedAt.toISOString().slice(0, 10);
          const v = byDay.get(day) ?? { impressions: 0, engagement: 0 };
          v.impressions += r.impressions;
          v.engagement += r.likes + r.comments + r.shares;
          byDay.set(day, v);
          likes += r.likes;
          comments += r.comments;
          shares += r.shares;
        }
        return {
          timeseries: Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v })),
          byType: { likes, comments, shares },
        };
      },
      { timeseries: [], byType: { likes: 0, comments: 0, shares: 0 } },
    );

    // ---- topPosts (top 5 by engagement) -------------------------------------
    const topPosts = await safe<ReportTopPost[]>(
      'top-posts',
      async () => {
        const posts = await db.post.findMany({
          where: postWhere,
          select: {
            title: true,
            format: true,
            analytics: {
              where: { capturedAt: { gte: start, lte: end } },
              select: { impressions: true, likes: true, comments: true, shares: true },
            },
            schedules: {
              where: { publishedAt: { not: null } },
              orderBy: { publishedAt: 'desc' },
              take: 1,
              select: { publishedAt: true, socialAccount: { select: { platform: true } } },
            },
          },
        });

        const mapped: ReportTopPost[] = posts.map((p) => {
          const impressions = p.analytics.reduce((s, a) => s + a.impressions, 0);
          const eng = p.analytics.reduce((s, a) => s + a.likes + a.comments + a.shares, 0);
          const sched = p.schedules[0];
          return {
            title: p.title ?? 'Sans titre',
            format: String(p.format),
            platform: sched?.socialAccount?.platform ? String(sched.socialAccount.platform) : '—',
            impressions,
            engagement: eng,
            engagementRate: engagementRate(eng, impressions),
            publishedAt: sched?.publishedAt ? sched.publishedAt.toISOString() : null,
          };
        });

        return mapped
          .filter((p) => p.impressions > 0 || p.engagement > 0)
          .sort((a, b) => b.engagement - a.engagement)
          .slice(0, 5);
      },
      [],
    );

    // ---- platforms ----------------------------------------------------------
    const platforms = await safe<ReportPlatform[]>(
      'platforms',
      async () => {
        const rows = await db.postAnalytics.findMany({
          where: analyticsWhere(start, end),
          select: {
            impressions: true,
            likes: true,
            comments: true,
            shares: true,
            postId: true,
            socialAccount: { select: { platform: true } },
          },
        });
        const map = new Map<
          string,
          { impressions: number; engagement: number; postIds: Set<string> }
        >();
        for (const r of rows) {
          const key = r.socialAccount?.platform ? String(r.socialAccount.platform) : 'OTHER';
          const v = map.get(key) ?? { impressions: 0, engagement: 0, postIds: new Set<string>() };
          v.impressions += r.impressions;
          v.engagement += r.likes + r.comments + r.shares;
          v.postIds.add(r.postId);
          map.set(key, v);
        }
        return Array.from(map.entries())
          .map(([platform, v]) => ({
            platform,
            posts: v.postIds.size,
            impressions: v.impressions,
            engagement: v.engagement,
            engagementRate: engagementRate(v.engagement, v.impressions),
          }))
          .sort((a, b) => b.engagement - a.engagement);
      },
      [],
    );

    const data: ReportData = { meta, overview, engagement, topPosts, platforms };

    // ---- competitors (optional section) -------------------------------------
    if (sections.includes('competitors')) {
      data.competitors = await safe<ReportCompetitor[]>(
        'competitors',
        async () => {
          const competitors = await db.competitor.findMany({
            where: { organizationId, ...(brandId ? { brandId } : {}) },
            select: {
              name: true,
              posts: {
                where: { postedAt: { gte: start, lte: end } },
                select: { likes: true, comments: true, shares: true },
              },
            },
          });
          return competitors
            .map((c) => {
              const total = c.posts.reduce(
                (s, p) => s + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0),
                0,
              );
              return {
                name: c.name,
                posts: c.posts.length,
                avgEngagement: c.posts.length ? round2(total / c.posts.length) : 0,
              };
            })
            .sort((a, b) => b.avgEngagement - a.avgEngagement);
        },
        [],
      );
    }

    return data;
  },

  /**
   * Ask the AI router (TEXT_STRATEGIC → Claude) for a 3-5 paragraph executive
   * summary in French that a non-technical agency client would read.
   * Never throws — returns mocked=true if AI is unavailable.
   */
  async generateAiSummary(opts: { data: ReportData; language?: string }): Promise<{ summary: string; mocked: boolean }> {
    const { data } = opts;
    const language = opts.language ?? 'fr';

    try {
      const o = data.overview;
      const d = o.deltaVsPrevious;
      const platformLines = data.platforms
        .map((p) => `- ${p.platform}: ${p.impressions} impressions, ${p.engagement} engagements (taux ${p.engagementRate}%)`)
        .join('\n');
      const topLines = data.topPosts
        .map((p, i) => `${i + 1}. "${p.title}" (${p.platform}, ${p.format}) — ${p.engagement} engagements, taux ${p.engagementRate}%`)
        .join('\n');
      const competitorLines = (data.competitors ?? [])
        .map((c) => `- ${c.name}: ${c.posts} publications, ${c.avgEngagement} engagements/post en moyenne`)
        .join('\n');

      const prompt = [
        `Tu es un consultant en marketing digital qui rédige le résumé exécutif d'un rapport de performance pour un client d'agence non technique.`,
        `Marque: ${data.meta.brandName} · Organisation: ${data.meta.orgName} · Période: ${data.meta.periodLabel}.`,
        ``,
        `Chiffres clés sur la période:`,
        `- Publications: ${o.totalPosts} (${d.posts >= 0 ? '+' : ''}${d.posts}% vs période précédente)`,
        `- Impressions: ${o.totalImpressions} (${d.impressions >= 0 ? '+' : ''}${d.impressions}%)`,
        `- Engagements: ${o.totalEngagement} (${d.engagement >= 0 ? '+' : ''}${d.engagement}%)`,
        `- Portée (reach): ${o.totalReach} (${d.reach >= 0 ? '+' : ''}${d.reach}%)`,
        `- Taux d'engagement moyen: ${o.avgEngagementRate}% (${d.engagementRatePct >= 0 ? '+' : ''}${d.engagementRatePct}% vs précédent)`,
        ``,
        `Répartition par plateforme:`,
        platformLines || '- (aucune donnée plateforme)',
        ``,
        `Meilleures publications:`,
        topLines || '- (aucune publication performante)',
        competitorLines ? `\nConcurrents:\n${competitorLines}` : '',
        ``,
        `Rédige un résumé exécutif de 3 à 5 paragraphes en ${language === 'fr' ? 'français' : language}, ton professionnel et accessible.`,
        `Structure: (1) bilan global et tendance, (2) ce qui a bien marché / victoires, (3) points de vigilance ou baisses,`,
        `(4) 2-3 recommandations concrètes pour la prochaine période. Pas de jargon technique, pas de listes à puces, des phrases fluides.`,
      ]
        .filter(Boolean)
        .join('\n');

      const result = await AIRouterService.generateTextForTask('TEXT_STRATEGIC', {
        prompt,
        language,
        maxTokens: 1200,
        temperature: 0.6,
      });

      const summary = (result.text ?? '').trim();
      if (!summary) {
        return { summary: this.fallbackSummary(data), mocked: true };
      }
      return { summary, mocked: !!result.mocked };
    } catch (err) {
      logger.warn('ReportingService.generateAiSummary failed', { err: (err as Error).message });
      return { summary: this.fallbackSummary(data), mocked: true };
    }
  },

  /** Deterministic French fallback used when no AI provider is available. */
  fallbackSummary(data: ReportData): string {
    const o = data.overview;
    const d = o.deltaVsPrevious;
    const trend = d.engagement >= 0 ? 'en progression' : 'en recul';
    return [
      `Sur la période « ${data.meta.periodLabel} », ${data.meta.brandName} a publié ${o.totalPosts} contenus, générant ${o.totalImpressions} impressions et ${o.totalEngagement} engagements, soit un taux d'engagement moyen de ${o.avgEngagementRate}%. La dynamique d'engagement est ${trend} (${d.engagement >= 0 ? '+' : ''}${d.engagement}%) par rapport à la période précédente.`,
      `Les meilleures performances proviennent ${data.topPosts[0] ? `notamment de « ${data.topPosts[0].title} » sur ${data.topPosts[0].platform}` : 'de plusieurs publications réparties sur les différents canaux'}, confirmant l'intérêt de l'audience pour ces formats.`,
      `Points de vigilance : ${d.impressions < 0 || d.reach < 0 ? 'la visibilité (impressions/portée) marque un léger recul qu\'il conviendra de surveiller.' : 'la visibilité reste stable, sans signal d\'alerte majeur.'}`,
      `Recommandations : capitaliser sur les formats les plus engageants, maintenir une cadence de publication régulière, et tester de nouveaux angles éditoriaux sur les plateformes les plus performantes.`,
    ].join('\n\n');
  },

  /**
   * Orchestrate a single report generation. Loads the row, flips to GENERATING,
   * gathers data, writes the AI summary, then flips to READY (or FAILED).
   * Throws only when the report id is unknown.
   */
  async generateReport(reportId: string): Promise<Report> {
    const report = await db.report.findUnique({ where: { id: reportId } });
    if (!report) throw new Error(`Report ${reportId} not found`);

    await safe('mark-generating', () =>
      db.report.update({ where: { id: reportId }, data: { status: 'GENERATING', errorMessage: null } }),
      undefined as unknown as Report,
    );

    try {
      const data = await this.gatherData({
        organizationId: report.organizationId,
        brandId: report.brandId,
        period: report.period,
        customStart: report.periodStart,
        customEnd: report.periodEnd,
        sections: report.sections,
      });

      const wantsSummary = report.sections.includes('ai-summary') || report.sections.includes('overview');
      const ai = wantsSummary
        ? await this.generateAiSummary({ data })
        : { summary: '', mocked: true };

      const updated = await db.report.update({
        where: { id: reportId },
        data: {
          status: 'READY',
          data: data as unknown as Prisma.InputJsonValue,
          aiSummary: ai.summary || null,
          generatedAt: new Date(),
          errorMessage: null,
        },
      });
      logger.info('ReportingService report ready', { reportId, mocked: ai.mocked });
      return updated;
    } catch (err) {
      const message = (err as Error).message;
      logger.error('ReportingService.generateReport failed', { reportId, err: message });
      return safe(
        'mark-failed',
        () =>
          db.report.update({
            where: { id: reportId },
            data: { status: 'FAILED', errorMessage: message.slice(0, 1000) },
          }),
        report,
      );
    }
  },

  /** List all reports for an org, newest first. Never throws. */
  async listForOrg(organizationId: string): Promise<Report[]> {
    return safe(
      'listForOrg',
      () =>
        db.report.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      [],
    );
  },

  /** Fetch a single report. Throws only when not found. */
  async getOne(reportId: string): Promise<Report> {
    const report = await db.report.findUnique({ where: { id: reportId } });
    if (!report) throw new Error(`Report ${reportId} not found`);
    return report;
  },

  /**
   * Next run date for a schedule given its frequency.
   * weekly = +7d, monthly = +1 month, once = null (no recurrence).
   */
  computeNextRun(frequency: ReportFrequency, from: Date = new Date()): Date | null {
    switch (frequency) {
      case 'WEEKLY':
        return new Date(from.getTime() + 7 * DAY_MS);
      case 'MONTHLY': {
        const d = new Date(from);
        d.setMonth(d.getMonth() + 1);
        return d;
      }
      case 'QUARTERLY': {
        const d = new Date(from);
        d.setMonth(d.getMonth() + 3);
        return d;
      }
      case 'ONCE':
      default:
        return null;
    }
  },
};
