/**
 * MentionListenerService — polls external sources for brand mentions and
 * persists them as BrandMention rows.
 *
 * Pipeline (pollWatch):
 *   1. load the MentionWatch
 *   2. fan out across watch.sources adapters in parallel (Promise.allSettled)
 *   3. flatten RawMentions, apply excludeKeywords filter
 *   4. dedup against existing BrandMention (watchId + externalId unique)
 *   5. score each NEW mention:
 *        - relevanceScore: keyword density / proximity heuristic (0..1)
 *        - sentiment + sentimentScore: batched via SentimentService
 *   6. persist new BrandMention rows, update watch.lastPolledAt
 *
 * Conventions mirror InboxIngestionService:
 *   - object-literal service, never throws past pollWatch
 *   - db from '@/lib/db', logger from '@/lib/logger'
 *   - [watchId, externalId] unique → P2002 means "already seen", skipped silently
 *   - one adapter failing must not kill the others (allSettled + defensive adapters)
 */
import type { BrandMention, MentionSentiment, MentionSource, MentionWatch, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { SentimentService } from '@/services/inbox/SentimentService';
import type { RawMention, SearchOpts } from './adapters/types';
import { search as redditSearch } from './adapters/reddit';
import { search as webSearch } from './adapters/web';
import { search as newsSearch } from './adapters/news';
import { search as twitterSearch } from './adapters/twitter';

type AdapterFn = (keywords: string[], opts?: SearchOpts) => Promise<RawMention[]>;

/** Source → adapter map. Sources without a wired adapter are silently skipped. */
const ADAPTERS: Partial<Record<MentionSource, AdapterFn>> = {
  REDDIT: redditSearch,
  WEB: webSearch,
  NEWS: newsSearch,
  TWITTER: twitterSearch,
};

const DEFAULT_LANGUAGE = 'fr';
const MAX_PER_SOURCE = 25;

/** A BrandMention row newly created by a poll (consumed by the alert engine). */
export interface NewMention {
  id: string;
  externalId: string;
  source: MentionSource;
  content: string;
  authorHandle: string | null;
  reach: number; // normalised (0 when null) for easy threshold checks
  sentiment: MentionSentiment;
  sentimentScore: number | null;
  relevanceScore: number | null;
  publishedAt: Date; // normalised (falls back to ingestedAt) for windowing
}

export interface PollWatchResult {
  watchId: string;
  found: number;
  new: number;
  mentions: NewMention[];
  error?: string;
}

export interface PollAllResult {
  watches: number;
  totalNew: number;
  results: PollWatchResult[];
}

export interface ListMentionsFilters {
  brandId?: string;
  watchId?: string;
  source?: MentionSource;
  sentiment?: MentionSentiment;
  status?: 'NEW' | 'REVIEWED' | 'RESPONDED' | 'IGNORED';
  search?: string;
  days?: number;
  take?: number;
  skip?: number;
}

export interface SentimentBreakdown {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
  unknown: number;
  /** Average sentimentScore across rows that have one (-1..1). */
  avgScore: number | null;
}

export const MentionListenerService = {
  /**
   * Poll a single watch by id. Never throws — returns a structured result with
   * an `error` field on failure.
   */
  async pollWatch(watchId: string): Promise<PollWatchResult> {
    const empty = (error?: string): PollWatchResult => ({
      watchId,
      found: 0,
      new: 0,
      mentions: [],
      ...(error ? { error } : {}),
    });

    let watch: MentionWatch | null = null;
    try {
      watch = await db.mentionWatch.findUnique({ where: { id: watchId } });
    } catch (err) {
      logger.warn('MentionListenerService.pollWatch: load failed', {
        watchId,
        err: (err as Error).message,
      });
      return empty('load_failed');
    }
    if (!watch) return empty('not_found');

    const keywords = (watch.keywords ?? []).map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) {
      await this.touchWatch(watchId);
      return empty();
    }

    // ---- 2. fan out across sources in parallel ------------------------------
    const sources = (watch.sources ?? []).filter((s) => ADAPTERS[s]);
    const opts: SearchOpts = { limit: MAX_PER_SOURCE, language: DEFAULT_LANGUAGE, watchId };

    const settled = await Promise.allSettled(
      sources.map((s) => (ADAPTERS[s] as AdapterFn)(keywords, opts)),
    );

    const raw: RawMention[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        raw.push(...r.value);
      } else {
        logger.warn('MentionListenerService: adapter rejected', {
          watchId,
          source: sources[i],
          err: String(r.reason),
        });
      }
    });

    // ---- 3. excludeKeywords filter ------------------------------------------
    const filtered = this.applyExcludeKeywords(watch, raw).filter((m) => !!m.externalId);

    // ---- 4. dedup within-batch + against existing rows ----------------------
    const byExternalId = new Map<string, RawMention>();
    for (const m of filtered) {
      if (!byExternalId.has(m.externalId)) byExternalId.set(m.externalId, m);
    }
    const candidates = [...byExternalId.values()];

    let existing = new Set<string>();
    try {
      const rows = await db.brandMention.findMany({
        where: { watchId, externalId: { in: candidates.map((c) => c.externalId) } },
        select: { externalId: true },
      });
      existing = new Set(rows.map((r) => r.externalId));
    } catch (err) {
      logger.warn('MentionListenerService: dedup query failed', {
        watchId,
        err: (err as Error).message,
      });
    }
    const fresh = candidates.filter((c) => !existing.has(c.externalId));

    // ---- 5a. relevance score (heuristic, cheap + deterministic) -------------
    const scored = fresh.map((m) => ({ raw: m, relevance: relevanceScore(m, keywords) }));

    // ---- 5b. sentiment batch -------------------------------------------------
    let sentimentById = new Map<string, { sentiment: MentionSentiment; score: number | null }>();
    try {
      const results = await SentimentService.classifyBatch(
        scored.map((m) => ({
          id: m.raw.externalId,
          content: `${m.raw.title ?? ''}\n${m.raw.content}`.trim(),
        })),
      );
      sentimentById = new Map(
        results.map((r) => [
          r.id,
          {
            sentiment: toMentionSentiment(r.sentiment),
            score: typeof r.score === 'number' ? r.score : null,
          },
        ]),
      );
    } catch (err) {
      logger.warn('MentionListenerService: sentiment batch failed', {
        watchId,
        err: (err as Error).message,
      });
    }

    // ---- 6. persist ----------------------------------------------------------
    const created = await this.persistMany(watch, scored, sentimentById);

    await this.touchWatch(watchId);

    return {
      watchId,
      found: raw.length,
      new: created.length,
      mentions: created,
    };
  },

  /**
   * Drop mentions whose title/content contains any of the watch's
   * excludeKeywords (case-insensitive substring). Pure + synchronous so it can
   * be unit-tested directly.
   */
  applyExcludeKeywords(watch: MentionWatch, raw: RawMention[]): RawMention[] {
    const exclude = (watch.excludeKeywords ?? []).filter(Boolean).map((k) => k.toLowerCase());
    if (exclude.length === 0) return raw;
    return raw.filter((m) => {
      const haystack = `${m.title ?? ''} ${m.content ?? ''}`.toLowerCase();
      return !exclude.some((term) => haystack.includes(term));
    });
  },

  /** Persist new mentions. Returns rows actually created (P2002 dups dropped). */
  async persistMany(
    watch: MentionWatch,
    items: Array<{ raw: RawMention; relevance: number }>,
    sentimentById: Map<string, { sentiment: MentionSentiment; score: number | null }>,
  ): Promise<NewMention[]> {
    const out: NewMention[] = [];
    for (const { raw: item, relevance } of items) {
      const s = sentimentById.get(item.externalId);
      const publishedAt = toDate(item.publishedAt) ?? new Date();
      try {
        // eslint-disable-next-line no-await-in-loop
        const row = await db.brandMention.create({
          data: {
            organizationId: watch.organizationId,
            brandId: watch.brandId,
            watchId: watch.id,
            source: item.source,
            externalId: item.externalId,
            url: item.url,
            authorHandle: item.authorHandle,
            authorName: item.authorName,
            title: item.title,
            content: item.content,
            reach: item.reach ?? null,
            engagementCount: item.engagementCount ?? null,
            language: item.language ?? DEFAULT_LANGUAGE,
            sentiment: s?.sentiment ?? 'UNKNOWN',
            sentimentScore: s?.score ?? null,
            relevanceScore: relevance,
            publishedAt,
            rawData: {} as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            externalId: true,
            source: true,
            content: true,
            authorHandle: true,
            reach: true,
            sentiment: true,
            sentimentScore: true,
            relevanceScore: true,
            publishedAt: true,
            ingestedAt: true,
          },
        });
        out.push({
          id: row.id,
          externalId: row.externalId,
          source: row.source,
          content: row.content,
          authorHandle: row.authorHandle,
          reach: row.reach ?? 0,
          sentiment: row.sentiment,
          sentimentScore: row.sentimentScore,
          relevanceScore: row.relevanceScore,
          publishedAt: row.publishedAt ?? row.ingestedAt,
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') continue; // already ingested
        logger.warn('MentionListenerService: persist failed', {
          externalId: item.externalId,
          err: (err as Error).message,
        });
      }
    }
    return out;
  },

  /** Poll every enabled watch in one org. Never throws. */
  async pollAllForOrg(orgId: string): Promise<PollAllResult> {
    return this.pollMany({ organizationId: orgId, enabled: true });
  },

  /** Poll every enabled watch (cron entrypoint). Never throws. */
  async pollAllEnabled(): Promise<PollAllResult> {
    return this.pollMany({ enabled: true });
  },

  async pollMany(where: Prisma.MentionWatchWhereInput): Promise<PollAllResult> {
    let watches: Array<{ id: string }> = [];
    try {
      watches = await db.mentionWatch.findMany({ where, select: { id: true } });
    } catch (err) {
      logger.error('MentionListenerService.pollMany: load watches failed', {
        err: (err as Error).message,
      });
      return { watches: 0, totalNew: 0, results: [] };
    }

    const results: PollWatchResult[] = [];
    let totalNew = 0;
    for (const w of watches) {
      // Sequential to be gentle on the (unauthenticated) public endpoints.
      // eslint-disable-next-line no-await-in-loop
      const r = await this.pollWatch(w.id);
      results.push(r);
      totalNew += r.new;
    }
    return { watches: watches.length, totalNew, results };
  },

  /** Bump lastPolledAt so the next tick can window correctly. Never throws. */
  async touchWatch(watchId: string): Promise<void> {
    try {
      await db.mentionWatch.update({ where: { id: watchId }, data: { lastPolledAt: new Date() } });
    } catch (err) {
      logger.warn('MentionListenerService.touchWatch failed', {
        watchId,
        err: (err as Error).message,
      });
    }
  },

  /** List mentions for an org with optional filters, newest first. Never throws. */
  async listMentions({
    orgId,
    filters = {},
  }: {
    orgId: string;
    filters?: ListMentionsFilters;
  }): Promise<BrandMention[]> {
    try {
      const where: Prisma.BrandMentionWhereInput = { organizationId: orgId };
      if (filters.brandId) where.brandId = filters.brandId;
      if (filters.watchId) where.watchId = filters.watchId;
      if (filters.source) where.source = filters.source;
      if (filters.sentiment) where.sentiment = filters.sentiment;
      if (filters.status) where.status = filters.status;
      if (filters.search) {
        where.OR = [
          { content: { contains: filters.search, mode: 'insensitive' } },
          { title: { contains: filters.search, mode: 'insensitive' } },
          { authorHandle: { contains: filters.search, mode: 'insensitive' } },
        ];
      }
      if (filters.days && filters.days > 0) {
        where.publishedAt = { gte: new Date(Date.now() - filters.days * 86_400_000) };
      }

      return await db.brandMention.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: Math.min(filters.take ?? 100, 500),
        skip: filters.skip ?? 0,
      });
    } catch (err) {
      logger.warn('MentionListenerService.listMentions failed', {
        orgId,
        err: (err as Error).message,
      });
      return [];
    }
  },

  /**
   * Sentiment distribution for an org (optionally a brand) over the last N days.
   * Never throws.
   */
  async getSentimentBreakdown(
    orgId: string,
    brandId?: string | null,
    days = 30,
  ): Promise<SentimentBreakdown> {
    const zero: SentimentBreakdown = {
      total: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      mixed: 0,
      unknown: 0,
      avgScore: null,
    };
    try {
      const where: Prisma.BrandMentionWhereInput = {
        organizationId: orgId,
        ...(brandId ? { brandId } : {}),
        ...(days > 0 ? { publishedAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}),
      };

      const [grouped, agg] = await Promise.all([
        db.brandMention.groupBy({ by: ['sentiment'], where, _count: { _all: true } }),
        db.brandMention.aggregate({ where, _avg: { sentimentScore: true } }),
      ]);

      const out = { ...zero };
      for (const g of grouped) {
        const n = g._count._all;
        out.total += n;
        switch (g.sentiment) {
          case 'POSITIVE': out.positive = n; break;
          case 'NEGATIVE': out.negative = n; break;
          case 'NEUTRAL': out.neutral = n; break;
          case 'MIXED': out.mixed = n; break;
          default: out.unknown = n; break;
        }
      }
      out.avgScore = typeof agg._avg.sentimentScore === 'number' ? agg._avg.sentimentScore : null;
      return out;
    } catch (err) {
      logger.warn('MentionListenerService.getSentimentBreakdown failed', {
        orgId,
        err: (err as Error).message,
      });
      return zero;
    }
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * SentimentService classifies into POSITIVE/NEGATIVE/NEUTRAL/SPAM/UNKNOWN, but
 * the BrandMention.sentiment column is the MentionSentiment enum
 * (POSITIVE/NEGATIVE/NEUTRAL/MIXED/UNKNOWN — no SPAM). Map SPAM → UNKNOWN.
 */
function toMentionSentiment(s: string): MentionSentiment {
  switch (String(s).toUpperCase()) {
    case 'POSITIVE': return 'POSITIVE';
    case 'NEGATIVE': return 'NEGATIVE';
    case 'NEUTRAL': return 'NEUTRAL';
    case 'MIXED': return 'MIXED';
    default: return 'UNKNOWN';
  }
}

function toDate(v?: number | Date): Date | undefined {
  if (v == null) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Simple relevance heuristic in [0..1]:
 *   - 0.5 weighted by the fraction of distinct keywords that appear
 *   - +0.3 if any keyword appears in the title
 *   - +0.2 for keyword density (hits per 100 words, capped at 1)
 * Cheap, deterministic, no AI call.
 */
function relevanceScore(m: RawMention, keywords: string[]): number {
  const title = (m.title ?? '').toLowerCase();
  const body = `${title} ${m.content}`.toLowerCase();
  if (!body.trim() || keywords.length === 0) return 0;

  const kws = keywords.map((k) => k.toLowerCase()).filter(Boolean);
  let matched = 0;
  let totalHits = 0;
  let inTitle = false;
  for (const kw of kws) {
    const hits = countOccurrences(body, kw);
    if (hits > 0) matched += 1;
    totalHits += hits;
    if (title.includes(kw)) inTitle = true;
  }

  const coverage = matched / kws.length; // 0..1
  const words = Math.max(body.split(/\s+/).length, 1);
  const density = Math.min(totalHits / (words / 100), 1); // hits per 100 words, capped

  const score = 0.5 * coverage + (inTitle ? 0.3 : 0) + 0.2 * density;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}
