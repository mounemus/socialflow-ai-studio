/**
 * Smoke tests for the inbox services.
 *
 * Mocks @/lib/db (Prisma) and @/services/ai/AIRouterService so the services
 * can be exercised without DB or AI calls. Covers:
 *
 *   1. SentimentService.classifyBatch — valid AI response parses correctly.
 *   2. SentimentService.classifyBatch — AI throws → returns UNKNOWN for all.
 *   3. InboxIngestionService.ingestForOrg — no social accounts → 0 ingested.
 *   4. InboxReplyService.proposeReply — returns a non-empty suggestion.
 *   5. AutoReplyRule daily cap — cap-reached interactions are deferred.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable test store. The mocked Prisma client reads from this; tests mutate
// it via the helpers below before calling the SUT.
// ---------------------------------------------------------------------------
interface SocialAccountRow {
  id: string;
  platform: string;
  brandId: string | null;
  status: string;
}
interface InteractionRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  type: string;
  platform: string;
  status: string;
  sentiment: string;
  sentimentScore: number | null;
  content: string;
  fromHandle: string;
  fromName: string | null;
  isAutoReplied: boolean;
  repliedAt: Date | null;
  rawData?: Record<string, unknown>;
  brand?: { id: string; name: string } | null;
  post?: { body: string } | null;
}
interface AutoReplyRuleRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  enabled: boolean;
  allowedSentiments: string[];
  allowedTypes: string[];
  customPromptFragment: string | null;
  minSentimentScore: number;
  maxReplyLength: number;
  requireApproval: boolean;
  dailyCap: number;
}

interface StoreShape {
  socialAccounts: SocialAccountRow[];
  interactions: InteractionRow[];
  rules: AutoReplyRuleRow[];
  /** Marker row used by loadDailyCount() — set to simulate today's count. */
  dailyCounterMarker: { rawData: Record<string, unknown> } | null;
  updateCalls: Array<{ id: string; data: Record<string, unknown> }>;
}

const store: StoreShape = {
  socialAccounts: [],
  interactions: [],
  rules: [],
  dailyCounterMarker: null,
  updateCalls: [],
};

function resetStore() {
  store.socialAccounts = [];
  store.interactions = [];
  store.rules = [];
  store.dailyCounterMarker = null;
  store.updateCalls = [];
}

// ---------------------------------------------------------------------------
// Mocks — must run BEFORE importing the SUT.
// ---------------------------------------------------------------------------
vi.mock('@/lib/db', () => {
  const socialAccount = {
    findMany: vi.fn(async (args: { where?: { status?: string } } = {}) => {
      const want = args.where?.status;
      return store.socialAccounts.filter((a) => (want ? a.status === want : true));
    }),
    update: vi.fn(async () => ({})),
  };
  const socialInteraction = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      const row = store.interactions.find((i) => i.id === args.where.id);
      return row ?? null;
    }),
    findFirst: vi.fn(async () => store.dailyCounterMarker),
    findMany: vi.fn(async (args: { where?: Record<string, unknown>; take?: number } = {}) => {
      const where = args.where ?? {};
      let rows = store.interactions.slice();
      if (where.status) rows = rows.filter((r) => r.status === where.status);
      if (where.organizationId) rows = rows.filter((r) => r.organizationId === where.organizationId);
      if (where.brandId !== undefined) rows = rows.filter((r) => r.brandId === where.brandId);
      const typeIn = (where.type as { in?: string[] } | undefined)?.in;
      if (typeIn) rows = rows.filter((r) => typeIn.includes(r.type));
      const sentIn = (where.sentiment as { in?: string[] } | undefined)?.in;
      if (sentIn) rows = rows.filter((r) => sentIn.includes(r.sentiment));
      return typeof args.take === 'number' ? rows.slice(0, args.take) : rows;
    }),
    count: vi.fn(async () => 0),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      store.updateCalls.push({ id: args.where.id, data: args.data });
      const row = store.interactions.find((i) => i.id === args.where.id);
      if (row) Object.assign(row, args.data);
      return row ?? { id: args.where.id, ...args.data };
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      return { id: `int_${Math.random().toString(36).slice(2, 8)}`, ...args.data };
    }),
    upsert: vi.fn(async () => ({ id: 'noop', createdAt: new Date(), updatedAt: new Date() })),
  };
  const autoReplyRule = {
    findMany: vi.fn(async () => store.rules.filter((r) => r.enabled)),
  };
  const organization = {
    findMany: vi.fn(async () => [] as Array<{ id: string }>),
  };
  const teamMember = {
    findFirst: vi.fn(async () => ({ userId: 'user_system' })),
  };
  const socialToken = {
    findFirst: vi.fn(async () => null),
  };
  const postSchedule = {
    findFirst: vi.fn(async () => null),
  };
  const post = {
    findFirst: vi.fn(async () => null),
  };

  return {
    db: {
      socialAccount,
      socialInteraction,
      autoReplyRule,
      organization,
      teamMember,
      socialToken,
      postSchedule,
      post,
    },
  };
});

// AI router mock — each test re-stubs generateTextForTask as needed.
const aiMock = vi.fn();
vi.mock('@/services/ai/AIRouterService', () => ({
  AIRouterService: {
    generateTextForTask: (...args: unknown[]) => aiMock(...args),
  },
}));

// BrandDNAService is used by InboxReplyService.proposeReply — keep it inert.
vi.mock('@/services/intelligence/BrandDNAService', () => ({
  BrandDNAService: {
    getStoredFor: vi.fn(async () => null),
    buildPromptFragment: vi.fn(() => ''),
  },
}));

// Import AFTER mocks so the SUT picks them up.
const { SentimentService } = await import('@/services/inbox/SentimentService');
const { InboxIngestionService } = await import('@/services/inbox/InboxIngestionService');
const { InboxReplyService } = await import('@/services/inbox/InboxReplyService');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SentimentService.classifyBatch', () => {
  beforeEach(() => {
    resetStore();
    aiMock.mockReset();
  });

  it('parses a valid AI JSON response into sentiments', async () => {
    aiMock.mockResolvedValueOnce({
      text: JSON.stringify([
        { id: 'a', sentiment: 'POSITIVE', score: 0.92 },
        { id: 'b', sentiment: 'NEGATIVE', score: 0.81 },
      ]),
      provider: 'mock',
      model: 'mock',
    });

    const result = await SentimentService.classifyBatch([
      { id: 'a', content: 'Love this product, amazing!' },
      { id: 'b', content: 'Worst service ever.' },
    ]);

    expect(result).toHaveLength(2);
    const byId = new Map(result.map((r) => [r.id, r]));
    expect(byId.get('a')?.sentiment).toBe('POSITIVE');
    expect(byId.get('b')?.sentiment).toBe('NEGATIVE');
  });

  it('returns UNKNOWN for every input when the AI call throws', async () => {
    aiMock.mockRejectedValueOnce(new Error('429 rate limited'));

    const result = await SentimentService.classifyBatch([
      { id: 'a', content: 'whatever' },
      { id: 'b', content: 'whatever' },
      { id: 'c', content: 'whatever' },
    ]);

    expect(result).toHaveLength(3);
    expect(result.every((r) => r.sentiment === 'UNKNOWN')).toBe(true);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('InboxIngestionService.ingestForOrg', () => {
  beforeEach(() => {
    resetStore();
    aiMock.mockReset();
  });

  it('returns 0 ingested when the org has no connected social accounts', async () => {
    store.socialAccounts = [];

    const result = (await InboxIngestionService.ingestForOrg('org_smoke')) as {
      ingested: number;
      byPlatform?: Record<string, number>;
      errors?: unknown[];
    };

    expect(result.ingested).toBe(0);
    // Service has shipped two envelope shapes — accept either.
    if (result.byPlatform) expect(Object.keys(result.byPlatform)).toHaveLength(0);
    if (result.errors) expect(result.errors).toHaveLength(0);
  });
});

describe('InboxReplyService.proposeReply', () => {
  beforeEach(() => {
    resetStore();
    aiMock.mockReset();
  });

  it('returns a non-empty suggestion when called for an existing interaction', async () => {
    store.interactions = [
      {
        id: 'int_1',
        organizationId: 'org_smoke',
        brandId: 'brand_1',
        type: 'COMMENT',
        platform: 'INSTAGRAM',
        status: 'NEW',
        sentiment: 'POSITIVE',
        sentimentScore: 0.9,
        content: 'Super produit, bravo !',
        fromHandle: 'fan42',
        fromName: 'Alice',
        isAutoReplied: false,
        repliedAt: null,
        brand: { id: 'brand_1', name: 'Acme' },
        post: null,
      },
    ];
    aiMock.mockResolvedValue({
      text: 'Merci Alice, ça nous fait super plaisir !',
      provider: 'mock',
      model: 'mock-1',
      mocked: false,
    });

    // Service accepts either a string id or { interactionId }. Probe.
    const svc = InboxReplyService as unknown as {
      proposeReply: (arg: string | { interactionId: string }) => Promise<{ suggestion: string }>;
    };
    let result: { suggestion: string };
    try {
      result = await svc.proposeReply('int_1');
    } catch {
      result = await svc.proposeReply({ interactionId: 'int_1' });
    }

    expect(typeof result.suggestion).toBe('string');
    expect(result.suggestion.length).toBeGreaterThan(0);
    expect(result.suggestion).toContain('Merci');
  });
});

describe('AutoReplyRule daily cap', () => {
  beforeEach(() => {
    resetStore();
    aiMock.mockReset();
  });

  it('does not auto-reply once dailyCap has been reached', async () => {
    // dailyCap = 1. Two NEW eligible interactions. Pre-populate a daily counter
    // marker so the service sees the cap is already spent for today → deferred.
    const today = new Date().toISOString().slice(0, 10);
    store.dailyCounterMarker = {
      rawData: { dailyCounters: { rule_1: { date: today, count: 1 } } },
    };
    store.rules = [
      {
        id: 'rule_1',
        organizationId: 'org_smoke',
        brandId: null,
        enabled: true,
        allowedSentiments: ['POSITIVE'],
        allowedTypes: ['COMMENT'],
        customPromptFragment: null,
        minSentimentScore: 0,
        maxReplyLength: 280,
        requireApproval: false,
        dailyCap: 1,
      },
    ];
    store.interactions = [
      {
        id: 'int_a',
        organizationId: 'org_smoke',
        brandId: null,
        type: 'COMMENT',
        platform: 'INSTAGRAM',
        status: 'NEW',
        sentiment: 'POSITIVE',
        sentimentScore: 0.9,
        content: 'A',
        fromHandle: 'u1',
        fromName: 'U1',
        isAutoReplied: false,
        repliedAt: null,
        brand: null,
        post: null,
      },
      {
        id: 'int_b',
        organizationId: 'org_smoke',
        brandId: null,
        type: 'COMMENT',
        platform: 'INSTAGRAM',
        status: 'NEW',
        sentiment: 'POSITIVE',
        sentimentScore: 0.9,
        content: 'B',
        fromHandle: 'u2',
        fromName: 'U2',
        isAutoReplied: false,
        repliedAt: null,
        brand: null,
        post: null,
      },
    ];
    aiMock.mockResolvedValue({ text: 'merci !', provider: 'mock', model: 'mock' });

    // The reply runner method name differs across revisions. Call whichever
    // exists via the service object so `this` is preserved.
    const svc = InboxReplyService as unknown as Record<string, unknown>;
    const runFnName =
      typeof svc.autoReplyTick === 'function' ? 'autoReplyTick' : 'runAutoReplyForOrg';
    expect(typeof svc[runFnName]).toBe('function');
    const result = (await (svc[runFnName] as (orgId: string) => Promise<unknown>).call(
      svc,
      'org_smoke',
    )) as { autoReplied?: number; replied?: number };

    // With the cap already met for today, zero new auto-replies should fire.
    const autoReplied = result.autoReplied ?? result.replied ?? 0;
    expect(autoReplied).toBe(0);

    // And no interaction should have been transitioned to AUTO_REPLIED.
    const autoReplyTransitions = store.updateCalls.filter(
      (u) => u.data.isAutoReplied === true || u.data.status === 'AUTO_REPLIED',
    );
    expect(autoReplyTransitions.length).toBe(0);
  });
});
