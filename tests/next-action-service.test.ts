/**
 * Smoke test for NextActionService.
 *
 * Mocks @/lib/db (Prisma client) and @/services/ai/AIRouterService so the
 * heuristic recommender pipeline can be exercised end-to-end without real DB
 * or AI calls. Verifies the 4 baseline scenarios:
 *   1. Empty org (no brands)             → BRAND_CREATE recommendation
 *   2. Brand exists but no BrandProfile  → BRAND_PROFILE_FILL recommendation
 *   3. Strategy items APPROVED           → STRATEGY_EXECUTE recommendation
 *   4. Everything green (no candidates)  → EXPLORE_ASSISTANT fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org_smoke';

// Per-test mutable store the mocked Prisma client reads from. We reset this
// in beforeEach so every test starts from a clean slate.
interface BrandWithProfile {
  id: string;
  name: string;
  profile: {
    id: string;
    slogan: string | null;
    mission: string | null;
    toneOfVoice: string | null;
    audienceTarget: string | null;
    values: string[];
    productsServices: string[];
  } | null;
}

interface PipelineRow {
  id: string;
  step: string;
  brand: { id: string; name: string } | null;
}

interface StrategyItemRow {
  strategyId: string;
  strategy: { brandId: string; brand: { id: string; name: string } };
}

interface StoreShape {
  brands: BrandWithProfile[];
  pipelinesAwaiting: PipelineRow[];
  strategyItemsApproved: StrategyItemRow[];
  schedulesManualNoMedia: number;
  schedulesManualNext7d: number;
  connectedAccounts: Array<{ platform: string }>;
  schedulesByPlatform: Array<{ socialAccount: { platform: string } | null }>;
  recentPosts: Array<{ id: string; metadata: unknown }>;
  aiRequestsForPosts: Array<{ metadata: unknown }>;
}

const store: StoreShape = {
  brands: [],
  pipelinesAwaiting: [],
  strategyItemsApproved: [],
  schedulesManualNoMedia: 0,
  schedulesManualNext7d: 0,
  connectedAccounts: [],
  schedulesByPlatform: [],
  recentPosts: [],
  aiRequestsForPosts: [],
};

function resetStore() {
  store.brands = [];
  store.pipelinesAwaiting = [];
  store.strategyItemsApproved = [];
  store.schedulesManualNoMedia = 0;
  store.schedulesManualNext7d = 0;
  store.connectedAccounts = [];
  store.schedulesByPlatform = [];
  store.recentPosts = [];
  store.aiRequestsForPosts = [];
}

vi.mock('@/lib/db', () => {
  const brand = {
    findMany: vi.fn(async () => store.brands),
  };
  const brandPipelineRun = {
    findMany: vi.fn(async () => store.pipelinesAwaiting),
  };
  const strategyItem = {
    findMany: vi.fn(async () => store.strategyItemsApproved),
  };
  const postSchedule = {
    count: vi.fn(async (args: { where?: Record<string, unknown> }) => {
      const where = args.where ?? {};
      // The service issues two count() calls — one for manual-no-media, one
      // for manual-next-7d. Distinguish them by the presence of `scheduledFor`.
      if (where.scheduledFor !== undefined) return store.schedulesManualNext7d;
      return store.schedulesManualNoMedia;
    }),
    findMany: vi.fn(async () => store.schedulesByPlatform),
  };
  const socialAccount = {
    findMany: vi.fn(async () => store.connectedAccounts),
  };
  const post = {
    findMany: vi.fn(async () => store.recentPosts),
  };
  const aIRequest = {
    findMany: vi.fn(async () => store.aiRequestsForPosts),
  };

  return {
    db: {
      brand,
      brandPipelineRun,
      strategyItem,
      postSchedule,
      socialAccount,
      post,
      aIRequest,
    },
  };
});

// Stub AIRouter so we never hit a real model. Default impl returns null-ish
// text so NextActionService falls back to its heuristic ranking.
vi.mock('@/services/ai/AIRouterService', () => ({
  AIRouterService: {
    generateTextForTask: vi.fn(async () => ({ text: '', provider: 'mock', model: 'mock' })),
  },
}));

// Import AFTER mocks so the SUT picks them up.
const { NextActionService } = await import('@/services/dashboard/NextActionService');

describe('NextActionService.computeFor (smoke)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('empty org (no brands) → recommends BRAND_CREATE', async () => {
    const result = await NextActionService.computeFor(ORG_ID);

    expect(result.recommended).toBeDefined();
    // The "create brand" candidate uses id `no_brand` and kind `BRAND_CREATE`.
    expect(result.recommended.kind).toBe('BRAND_CREATE');
    expect(result.recommended.id).toBe('no_brand');
    expect(result.recommended.ctaHref).toContain('/brands');
  });

  it('brand exists but no BrandProfile → recommends BRAND_PROFILE_FILL', async () => {
    store.brands = [
      { id: 'brand_1', name: 'Acme', profile: null },
    ];

    const result = await NextActionService.computeFor(ORG_ID);

    expect(result.recommended.kind).toBe('BRAND_PROFILE_FILL');
    expect(result.recommended.id).toBe('brand_profile:brand_1');
    // Recommendation targets the brand profile page for enrichment.
    expect(result.recommended.ctaHref).toBe('/brands/brand_1');
  });

  it('strategy items APPROVED → recommendation mentions execution', async () => {
    // Brand has a complete profile so the profile candidate does NOT fire.
    store.brands = [
      {
        id: 'brand_1',
        name: 'Acme',
        profile: {
          id: 'profile_1',
          slogan: 'Stay sharp',
          mission: 'Empower coffee lovers',
          toneOfVoice: 'warm, witty',
          audienceTarget: 'urban millennials',
          values: ['craft', 'community'],
          productsServices: ['espresso', 'beans'],
        },
      },
    ];
    // 2 approved strategy items for that brand → STRATEGY_EXECUTE candidate.
    store.strategyItemsApproved = [
      {
        strategyId: 'strat_1',
        strategy: { brandId: 'brand_1', brand: { id: 'brand_1', name: 'Acme' } },
      },
      {
        strategyId: 'strat_1',
        strategy: { brandId: 'brand_1', brand: { id: 'brand_1', name: 'Acme' } },
      },
    ];
    // Ensure no other higher-severity candidate fires.
    store.pipelinesAwaiting = [];
    store.schedulesManualNoMedia = 0;
    store.schedulesManualNext7d = 0;

    const result = await NextActionService.computeFor(ORG_ID);

    // The recommended action OR one of `others` should describe execution.
    const all = [result.recommended, ...result.others];
    const strategy = all.find(
      (a) => a.kind === 'STRATEGY_EXECUTE' || a.id.startsWith('strategy_execute:'),
    );
    expect(strategy).toBeDefined();
    expect(strategy!.title.toLowerCase()).toContain('exécute');
  });

  it('everything green → returns EXPLORE_ASSISTANT fallback', async () => {
    // No brands, no profile, no pipelines, no items, no schedules → but the
    // service ALWAYS surfaces "no brand" first. To reach the truly-green
    // fallback we need one brand WITH a profile, no other signals at all,
    // and we need buildCandidates() to return zero matches. The service
    // produces an `all_green` candidate when nothing fires; that becomes
    // the recommended action.
    store.brands = [
      {
        id: 'brand_1',
        name: 'Acme',
        profile: {
          id: 'profile_1',
          slogan: 'Stay sharp',
          mission: 'Empower coffee lovers',
          toneOfVoice: 'warm, witty',
          audienceTarget: 'urban millennials',
          values: ['craft', 'community'],
          productsServices: ['espresso', 'beans'],
        },
      },
    ];

    const result = await NextActionService.computeFor(ORG_ID);

    // The "all green" candidate id/kind, or fallback EXPLORE_ASSISTANT.
    expect(['all_green', 'explore_assistant']).toContain(result.recommended.id);
    expect(['ALL_GREEN', 'EXPLORE_ASSISTANT']).toContain(result.recommended.kind);
    expect(result.recommended.severity).toBe('low');
  });
});
