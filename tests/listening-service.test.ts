/**
 * Smoke tests for the social-listening services.
 *
 * Mocks @/lib/db (Prisma) with an in-memory store, mocks the per-source
 * listening adapters (so no real network call to Reddit / News / Web / X), and
 * stubs SentimentService so classification is deterministic and offline.
 *
 * Pattern mirrors tests/brand-pipeline-service.test.ts (in-memory db) and
 * tests/inbox-services.test.ts (adapter + AI mocks).
 *
 * Covers:
 *   1. MentionListenerService.pollWatch dedups — polling twice with the same
 *      RawMention (same watchId+externalId) inserts the row only once.
 *   2. excludeKeywords filter — a fetched mention containing an excluded term
 *      is dropped before persistence.
 *   3. MentionAlertService.evaluateWatch raises a NEGATIVE_MENTION alert when a
 *      new mention has sentiment NEGATIVE and score <= -0.3.
 *   4. evaluateWatch does NOT raise a duplicate NEGATIVE_MENTION alert for the
 *      same mention ids within the 6h dedupe window.
 *   5. MentionListenerService.getSentimentBreakdown returns counts grouped by
 *      sentiment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawMention } from '@/services/listening/adapters/types';

// ---------------------------------------------------------------------------
// In-memory store. The mocked Prisma client reads/writes this; each test resets
// it in beforeEach and seeds what it needs.
// ---------------------------------------------------------------------------
interface WatchRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  name: string;
  keywords: string[];
  excludeKeywords: string[];
  sources: string[];
  enabled: boolean;
  alertOnNegative: boolean;
  alertOnSpike: boolean;
  lastPolledAt: Date | null;
}

interface MentionRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  watchId: string;
  source: string;
  externalId: string;
  url: string | null;
  authorHandle: string | null;
  authorName: string | null;
  title: string | null;
  content: string;
  reach: number | null;
  engagementCount: number | null;
  language: string | null;
  sentiment: string;
  sentimentScore: number | null;
  relevanceScore: number | null;
  publishedAt: Date | null;
  ingestedAt: Date;
  rawData: unknown;
}

interface AlertRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  watchId: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  mentionIds: string[];
  createdAt: Date;
}

interface StoreShape {
  watches: WatchRow[];
  mentions: MentionRow[];
  alerts: AlertRow[];
  seq: number;
}

const store: StoreShape = { watches: [], mentions: [], alerts: [], seq: 0 };

function nextId(prefix: string): string {
  store.seq += 1;
  return `${prefix}_${store.seq}`;
}

function resetStore() {
  store.watches = [];
  store.mentions = [];
  store.alerts = [];
  store.seq = 0;
}

// ---------------------------------------------------------------------------
// Adapter mocks — each source adapter exports `search(keywords, opts)`.
// Tests drive the reddit adapter's output via `redditReturn`; the others return
// [] so only Reddit produces mentions. This keeps the SUT offline.
// ---------------------------------------------------------------------------
let redditReturn: RawMention[] = [];
const redditSearch = vi.fn(async (..._a: unknown[]) => redditReturn);
const emptySearch = vi.fn(async (..._a: unknown[]) => [] as RawMention[]);

vi.mock('@/services/listening/adapters/reddit', () => ({
  search: (...a: unknown[]) => redditSearch(...a),
}));
vi.mock('@/services/listening/adapters/web', () => ({
  search: (...a: unknown[]) => emptySearch(...a),
}));
vi.mock('@/services/listening/adapters/news', () => ({
  search: (...a: unknown[]) => emptySearch(...a),
}));
vi.mock('@/services/listening/adapters/twitter', () => ({
  search: (...a: unknown[]) => emptySearch(...a),
}));

// ---------------------------------------------------------------------------
// db mock — in-memory Prisma.
// ---------------------------------------------------------------------------
vi.mock('@/lib/db', () => {
  const mentionWatch = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return store.watches.find((w) => w.id === args.where.id) ?? null;
    }),
    findMany: vi.fn(
      async (args: { where?: { enabled?: boolean; organizationId?: string }; select?: unknown } = {}) => {
        const where = args.where ?? {};
        return store.watches
          .filter((w) => (typeof where.enabled === 'boolean' ? w.enabled === where.enabled : true))
          .filter((w) => (where.organizationId ? w.organizationId === where.organizationId : true))
          .map((w) => ({ id: w.id }));
      },
    ),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<WatchRow> }) => {
      const w = store.watches.find((x) => x.id === args.where.id);
      if (w) Object.assign(w, args.data);
      return w ?? { id: args.where.id, ...args.data };
    }),
  };

  const brandMention = {
    // Dedup pre-check used by pollWatch: findMany({ where: { watchId, externalId: { in } } }).
    findMany: vi.fn(
      async (args: {
        where?: { watchId?: string; externalId?: { in?: string[] }; organizationId?: string };
        select?: Record<string, boolean>;
      } = {}) => {
        const where = args.where ?? {};
        let rows = store.mentions.slice();
        if (where.watchId) rows = rows.filter((m) => m.watchId === where.watchId);
        if (where.organizationId) rows = rows.filter((m) => m.organizationId === where.organizationId);
        const ext = where.externalId?.in;
        if (ext) rows = rows.filter((m) => ext.includes(m.externalId));
        return rows;
      },
    ),
    create: vi.fn(async (args: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const data = args.data;
      const watchId = data.watchId as string;
      const externalId = data.externalId as string;
      // Backstop unique check → throw P2002-shaped error like real Prisma.
      if (store.mentions.some((m) => m.watchId === watchId && m.externalId === externalId)) {
        const e = new Error('Unique constraint failed') as Error & { code: string };
        e.code = 'P2002';
        throw e;
      }
      const row: MentionRow = {
        id: nextId('mention'),
        organizationId: data.organizationId as string,
        brandId: (data.brandId as string | null) ?? null,
        watchId,
        source: data.source as string,
        externalId,
        url: (data.url as string | null) ?? null,
        authorHandle: (data.authorHandle as string | null) ?? null,
        authorName: (data.authorName as string | null) ?? null,
        title: (data.title as string | null) ?? null,
        content: data.content as string,
        reach: (data.reach as number | null) ?? null,
        engagementCount: (data.engagementCount as number | null) ?? null,
        language: (data.language as string | null) ?? null,
        sentiment: (data.sentiment as string) ?? 'UNKNOWN',
        sentimentScore: (data.sentimentScore as number | null) ?? null,
        relevanceScore: (data.relevanceScore as number | null) ?? null,
        publishedAt: (data.publishedAt as Date | null) ?? new Date(),
        ingestedAt: new Date(),
        rawData: data.rawData ?? {},
      };
      store.mentions.push(row);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<MentionRow> }) => {
      const m = store.mentions.find((x) => x.id === args.where.id);
      if (m) Object.assign(m, args.data);
      return m ?? { id: args.where.id, ...args.data };
    }),
    count: vi.fn(
      async (args: { where?: { watchId?: string; publishedAt?: { gte?: Date; lt?: Date } } } = {}) => {
        const where = args.where ?? {};
        return store.mentions.filter((m) => {
          if (where.watchId && m.watchId !== where.watchId) return false;
          const pub = m.publishedAt?.getTime() ?? 0;
          if (where.publishedAt?.gte && pub < where.publishedAt.gte.getTime()) return false;
          if (where.publishedAt?.lt && pub >= where.publishedAt.lt.getTime()) return false;
          return true;
        }).length;
      },
    ),
    groupBy: vi.fn(
      async (args: {
        by: string[];
        where?: { organizationId?: string; brandId?: string; publishedAt?: { gte?: Date } };
      }) => {
        const where = args.where ?? {};
        const rows = store.mentions.filter((m) => {
          if (where.organizationId && m.organizationId !== where.organizationId) return false;
          if (where.brandId && m.brandId !== where.brandId) return false;
          if (where.publishedAt?.gte && (m.publishedAt?.getTime() ?? 0) < where.publishedAt.gte.getTime()) {
            return false;
          }
          return true;
        });
        const counts = new Map<string, number>();
        for (const m of rows) counts.set(m.sentiment, (counts.get(m.sentiment) ?? 0) + 1);
        return Array.from(counts.entries()).map(([sentiment, n]) => ({
          sentiment,
          _count: { _all: n },
        }));
      },
    ),
    aggregate: vi.fn(
      async (args: { where?: { organizationId?: string }; _avg?: { sentimentScore?: boolean } }) => {
        const where = args.where ?? {};
        const rows = store.mentions.filter((m) =>
          where.organizationId ? m.organizationId === where.organizationId : true,
        );
        const scored = rows
          .map((m) => m.sentimentScore)
          .filter((s): s is number => typeof s === 'number');
        const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
        return { _avg: { sentimentScore: avg } };
      },
    ),
  };

  const mentionAlert = {
    findMany: vi.fn(
      async (args: {
        where?: { watchId?: string; type?: string; createdAt?: { gte?: Date } };
        select?: Record<string, boolean>;
      } = {}) => {
        const where = args.where ?? {};
        return store.alerts.filter((a) => {
          if (where.watchId && a.watchId !== where.watchId) return false;
          if (where.type && a.type !== where.type) return false;
          if (where.createdAt?.gte && a.createdAt.getTime() < where.createdAt.gte.getTime()) return false;
          return true;
        });
      },
    ),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const data = args.data;
      const row: AlertRow = {
        id: nextId('alert'),
        organizationId: data.organizationId as string,
        brandId: (data.brandId as string | null) ?? null,
        watchId: data.watchId as string,
        type: data.type as string,
        severity: data.severity as string,
        title: data.title as string,
        message: data.message as string,
        mentionIds: (data.mentionIds as string[]) ?? [],
        createdAt: new Date(),
      };
      store.alerts.push(row);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<AlertRow> }) => {
      const a = store.alerts.find((x) => x.id === args.where.id);
      if (a) Object.assign(a, args.data);
      return a ?? { id: args.where.id, ...args.data };
    }),
  };

  return { db: { mentionWatch, brandMention, mentionAlert } };
});

// Stub SentimentService so pollWatch's classification pass is deterministic and
// offline. Each test sets the mapping via `sentimentFor`.
let sentimentFor: (id: string, content: string) => { sentiment: string; score: number };
vi.mock('@/services/inbox/SentimentService', () => ({
  SentimentService: {
    classifyBatch: vi.fn(async (items: Array<{ id: string; content: string }>) =>
      items.map((it) => ({ id: it.id, ...sentimentFor(it.id, it.content) })),
    ),
  },
}));

// Import AFTER the mocks so the SUT picks up the in-memory db + stubs.
const { MentionListenerService } = await import('@/services/listening/MentionListenerService');
const { MentionAlertService } = await import('@/services/listening/MentionAlertService');
import type { NewMention } from '@/services/listening/MentionListenerService';
import type { MentionWatch } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeWatch(overrides: Partial<WatchRow> = {}): WatchRow {
  const w: WatchRow = {
    id: overrides.id ?? nextId('watch'),
    organizationId: overrides.organizationId ?? 'org_1',
    brandId: overrides.brandId ?? null,
    name: overrides.name ?? 'Acme veille',
    keywords: overrides.keywords ?? ['acme'],
    excludeKeywords: overrides.excludeKeywords ?? [],
    sources: overrides.sources ?? ['REDDIT'],
    enabled: overrides.enabled ?? true,
    alertOnNegative: overrides.alertOnNegative ?? true,
    alertOnSpike: overrides.alertOnSpike ?? false,
    lastPolledAt: overrides.lastPolledAt ?? null,
  };
  store.watches.push(w);
  return w;
}

function rawMention(overrides: Partial<RawMention> = {}): RawMention {
  return {
    source: 'REDDIT',
    externalId: overrides.externalId ?? 'reddit_post_1',
    url: 'https://www.reddit.com/r/acme/x',
    authorHandle: 'redditor',
    authorName: 'A Redditor',
    title: overrides.title ?? 'Acme is great',
    content: overrides.content ?? 'Talking about acme today, solid product.',
    reach: overrides.reach ?? 1000,
    engagementCount: 5,
    language: 'en',
    publishedAt: overrides.publishedAt ?? Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
  redditReturn = [];
  redditSearch.mockClear();
  emptySearch.mockClear();
  sentimentFor = () => ({ sentiment: 'NEUTRAL', score: 0 });
});

// ---------------------------------------------------------------------------
// 1. pollWatch dedups on (watchId, externalId)
// ---------------------------------------------------------------------------
describe('MentionListenerService.pollWatch', () => {
  it('inserts a mention only once when polled twice (dedup on watchId+externalId)', async () => {
    const watch = makeWatch({ keywords: ['acme'], sources: ['REDDIT'] });
    redditReturn = [rawMention({ externalId: 'reddit_post_1' })];

    const first = await MentionListenerService.pollWatch(watch.id);
    expect(first.new).toBe(1);
    expect(store.mentions.length).toBe(1);

    // Second poll returns the SAME RawMention (same externalId) → deduped, no insert.
    const second = await MentionListenerService.pollWatch(watch.id);
    expect(second.new).toBe(0);
    expect(store.mentions.length).toBe(1);

    // Compound key (watchId, externalId) is unique across the whole store.
    const keys = store.mentions.map((m) => `${m.watchId}::${m.externalId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 2. excludeKeywords filter
// ---------------------------------------------------------------------------
describe('MentionListenerService excludeKeywords', () => {
  it('drops a fetched mention that contains an excluded term', async () => {
    const watch = makeWatch({
      keywords: ['acme'],
      excludeKeywords: ['giveaway'],
      sources: ['REDDIT'],
    });
    redditReturn = [
      rawMention({ externalId: 'keep_1', title: 'Acme review', content: 'Acme works well.' }),
      rawMention({
        externalId: 'drop_1',
        title: 'Acme GIVEAWAY!!!',
        content: 'Enter our acme giveaway now',
      }),
    ];

    const res = await MentionListenerService.pollWatch(watch.id);

    // Only the non-excluded mention is persisted.
    expect(res.new).toBe(1);
    expect(store.mentions.length).toBe(1);
    expect(store.mentions[0].externalId).toBe('keep_1');
    expect(store.mentions.some((m) => m.externalId === 'drop_1')).toBe(false);
  });

  it('applyExcludeKeywords is a pure filter over title + content', () => {
    const watch = makeWatch({ excludeKeywords: ['spam'] });
    const kept = MentionListenerService.applyExcludeKeywords(watch as unknown as MentionWatch, [
      rawMention({ externalId: 'a', title: 'clean', content: 'all good' }),
      rawMention({ externalId: 'b', title: 'SPAM offer', content: 'buy now' }),
    ]);
    expect(kept.map((m) => m.externalId)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// 3. + 4. MentionAlertService.evaluateWatch — NEGATIVE_MENTION + 6h dedupe
// ---------------------------------------------------------------------------
describe('MentionAlertService.evaluateWatch (NEGATIVE_MENTION)', () => {
  function negativeMention(id: string): NewMention {
    return {
      id,
      externalId: `ext_${id}`,
      source: 'WEB',
      content: 'This brand is terrible, worst experience ever.',
      authorHandle: 'angry_user',
      reach: 0,
      sentiment: 'NEGATIVE',
      sentimentScore: -0.8, // <= -0.3 threshold
      relevanceScore: 0.9,
      publishedAt: new Date(),
    };
  }

  it('raises a NEGATIVE_MENTION (CRITICAL) alert for a NEGATIVE mention with score <= -0.3', async () => {
    const watch = makeWatch({ alertOnNegative: true, alertOnSpike: false });

    const res = await MentionAlertService.evaluateWatch(watch.id, [negativeMention('m1')]);

    const negativeAlerts = res.alerts.filter((a) => a.type === 'NEGATIVE_MENTION');
    expect(negativeAlerts.length).toBe(1);
    expect(negativeAlerts[0].severity).toBe('CRITICAL');
    expect(negativeAlerts[0].mentionIds).toContain('m1');
    expect(store.alerts.filter((a) => a.type === 'NEGATIVE_MENTION').length).toBe(1);
  });

  it('does NOT raise a duplicate NEGATIVE_MENTION alert for the same mention ids within 6h', async () => {
    const watch = makeWatch({ alertOnNegative: true, alertOnSpike: false });

    const first = await MentionAlertService.evaluateWatch(watch.id, [negativeMention('m1')]);
    expect(first.alerts.filter((a) => a.type === 'NEGATIVE_MENTION').length).toBe(1);

    // Re-evaluating the SAME mention id immediately is suppressed by the 6h
    // dedupe window (a fresh alert of that type already overlaps these ids).
    const second = await MentionAlertService.evaluateWatch(watch.id, [negativeMention('m1')]);
    expect(second.alerts.filter((a) => a.type === 'NEGATIVE_MENTION').length).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);

    // Still only one NEGATIVE_MENTION alert persisted overall.
    expect(store.alerts.filter((a) => a.type === 'NEGATIVE_MENTION').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. getSentimentBreakdown
// ---------------------------------------------------------------------------
describe('MentionListenerService.getSentimentBreakdown', () => {
  it('returns counts grouped by sentiment', async () => {
    const watch = makeWatch();
    const seed = (sentiment: string, score: number, n: number) => {
      for (let i = 0; i < n; i += 1) {
        store.mentions.push({
          id: nextId('mention'),
          organizationId: watch.organizationId,
          brandId: null,
          watchId: watch.id,
          source: 'REDDIT',
          externalId: nextId('ext'),
          url: null,
          authorHandle: null,
          authorName: null,
          title: null,
          content: 'x',
          reach: null,
          engagementCount: null,
          language: 'fr',
          sentiment,
          sentimentScore: score,
          relevanceScore: 0.5,
          publishedAt: new Date(),
          ingestedAt: new Date(),
          rawData: {},
        });
      }
    };
    seed('POSITIVE', 0.8, 3);
    seed('NEGATIVE', -0.7, 2);
    seed('NEUTRAL', 0, 1);

    const breakdown = await MentionListenerService.getSentimentBreakdown(watch.organizationId);

    expect(breakdown.total).toBe(6);
    expect(breakdown.positive).toBe(3);
    expect(breakdown.negative).toBe(2);
    expect(breakdown.neutral).toBe(1);
    // Untouched buckets are present and zero.
    expect(breakdown.mixed).toBe(0);
    expect(breakdown.unknown).toBe(0);
    // avgScore is the mean of the scored rows.
    expect(breakdown.avgScore).toBeCloseTo((0.8 * 3 + -0.7 * 2 + 0) / 6, 5);
  });
});
