/**
 * Smoke test for ConcretizationService.
 *
 * Mocks @/lib/db (Prisma client) with an in-memory store and mocks
 * @/services/ai/AIRouterService so the test is deterministic. Verifies:
 *   1. concretizeItem on a POST_IDEA item generates caption + at least one image variant
 *   2. concretizeItem on a REEL_IDEA generates videoScript
 *   3. concretizeItem on an EMAIL_IDEA generates emailSubject + emailBody
 *   4. regenerateVisual keeps caption, only swaps image
 *   5. markItemReady transitions status to 'ready' in item.metadata
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org_1';
const USER_ID = 'user_1';
const STRATEGY_ID = 'strat_1';

interface StrategyItemRecord {
  id: string;
  strategyId: string;
  order: number;
  kind: string;
  status: string;
  title: string;
  description: string;
  platform: string | null;
  format: string | null;
  suggestedDate: Date | null;
  hashtags: string[];
  cta: string | null;
  postId: string | null;
  campaignId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface StrategyRecord {
  id: string;
  organizationId: string;
  brandId: string;
  title: string;
  status: string;
  horizon: string | null;
}

interface BrandRecord {
  id: string;
  organizationId: string;
  name: string;
  industry: string | null;
}

const store: {
  items: StrategyItemRecord[];
  strategies: StrategyRecord[];
  brands: BrandRecord[];
  seq: number;
} = { items: [], strategies: [], brands: [], seq: 0 };

function nextId(prefix: string): string {
  store.seq += 1;
  return `${prefix}_${store.seq}`;
}

function seedItem(partial: Partial<StrategyItemRecord> & { kind: string }): StrategyItemRecord {
  const now = new Date();
  const rec: StrategyItemRecord = {
    id: partial.id ?? nextId('item'),
    strategyId: partial.strategyId ?? STRATEGY_ID,
    order: partial.order ?? 0,
    kind: partial.kind,
    status: partial.status ?? 'APPROVED',
    title: partial.title ?? 'Untitled',
    description: partial.description ?? 'Some description',
    platform: partial.platform ?? null,
    format: partial.format ?? null,
    suggestedDate: partial.suggestedDate ?? null,
    hashtags: partial.hashtags ?? [],
    cta: partial.cta ?? null,
    postId: partial.postId ?? null,
    campaignId: partial.campaignId ?? null,
    metadata: partial.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
  store.items.push(rec);
  return rec;
}

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('@/lib/db', () => {
  const strategyItem = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return store.items.find((i) => i.id === args.where.id) ?? null;
    }),
    findFirst: vi.fn(async (args: { where: { id: string } }) => {
      return store.items.find((i) => i.id === args.where.id) ?? null;
    }),
    update: vi.fn(
      async (args: { where: { id: string }; data: Partial<StrategyItemRecord> }) => {
        const idx = store.items.findIndex((i) => i.id === args.where.id);
        if (idx < 0) throw new Error(`item ${args.where.id} not found`);
        const prev = store.items[idx];
        // Deep-merge metadata so concretizeItem can patch incrementally.
        const nextMeta =
          args.data.metadata && typeof args.data.metadata === 'object'
            ? { ...(prev.metadata as Record<string, unknown>), ...(args.data.metadata as Record<string, unknown>) }
            : prev.metadata;
        const merged: StrategyItemRecord = {
          ...prev,
          ...args.data,
          metadata: nextMeta,
          updatedAt: new Date(),
        };
        store.items[idx] = merged;
        return merged;
      },
    ),
  };

  const marketingStrategy = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return store.strategies.find((s) => s.id === args.where.id) ?? null;
    }),
  };

  const brand = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return store.brands.find((b) => b.id === args.where.id) ?? null;
    }),
    findFirst: vi.fn(async (args: { where: { id?: string } }) => {
      return store.brands.find((b) => b.id === args.where.id) ?? null;
    }),
  };

  return { db: { strategyItem, marketingStrategy, brand } };
});

// Predictable AIRouter outputs so assertions are deterministic.
vi.mock('@/services/ai/AIRouterService', () => {
  const generateTextForTask = vi.fn(async (task: string) => {
    if (task === 'TEXT_SHORT_COPY') {
      return { text: '[MOCK CAPTION] Découvrez notre nouveauté ✨ #brand', parsed: undefined };
    }
    if (task === 'TEXT_REEL_SCRIPT') {
      return {
        text: '[MOCK SCRIPT] Hook: …\nScene 1: …\nCTA: …',
        parsed: undefined,
      };
    }
    if (task === 'TEXT_EMAIL') {
      return {
        text: 'SUBJECT: Bienvenue chez Acme\n\nBODY: Bonjour, voici notre histoire…',
        parsed: { subject: '[MOCK] Bienvenue chez Acme', body: '[MOCK] Bonjour, voici notre histoire…' },
      };
    }
    return { text: '[MOCK TEXT]', parsed: undefined };
  });

  const generateImageForTask = vi.fn(async () => ({
    url: 'https://mock.example.com/image.png',
    provider: 'mock' as never,
    mocked: true,
  }));

  return {
    AIRouterService: { generateTextForTask, generateImageForTask },
  };
});

// ============================================================================
// IMPORT SUT AFTER MOCKS
// ============================================================================

const { ConcretizationService } = await import('@/services/concretization/ConcretizationService');

// ============================================================================
// TESTS
// ============================================================================

describe('ConcretizationService (smoke)', () => {
  beforeEach(() => {
    store.items = [];
    store.strategies = [];
    store.brands = [];
    store.seq = 0;

    // Seed a brand + strategy so the service can look up context.
    store.brands.push({
      id: 'brand_1',
      organizationId: ORG_ID,
      name: 'Acme Coffee',
      industry: 'food',
    });
    store.strategies.push({
      id: STRATEGY_ID,
      organizationId: ORG_ID,
      brandId: 'brand_1',
      title: 'Q1 plan',
      status: 'APPROVED',
      horizon: '90d',
    });
  });

  it('concretizeItem on a POST_IDEA generates caption + at least one image variant', async () => {
    const item = seedItem({
      kind: 'POST_IDEA',
      title: 'Lancement saveur Vanille',
      description: 'Annoncer la nouvelle saveur vanille en story + post',
      platform: 'INSTAGRAM',
      format: 'INSTAGRAM_POST',
    });

    const result = await ConcretizationService.concretizeItem({
      itemId: item.id,
      userId: USER_ID,
    });

    expect(result).toBeTruthy();
    const updated = store.items.find((i) => i.id === item.id)!;
    const meta = updated.metadata as Record<string, unknown>;

    // caption present
    const caption = (meta.caption as string) ?? (meta.copy as string) ?? '';
    expect(typeof caption).toBe('string');
    expect(caption.length).toBeGreaterThan(0);

    // at least one image variant
    const variants =
      (meta.imageVariants as unknown[]) ??
      (meta.images as unknown[]) ??
      (meta.visuals as unknown[]) ??
      [];
    expect(Array.isArray(variants)).toBe(true);
    expect(variants.length).toBeGreaterThanOrEqual(1);
  });

  it('concretizeItem on a REEL_IDEA generates a videoScript', async () => {
    const item = seedItem({
      kind: 'REEL_IDEA',
      title: 'Behind the scenes torréfaction',
      description: 'Reel 30s montrant le processus de torréfaction',
      platform: 'INSTAGRAM',
      format: 'INSTAGRAM_REEL',
    });

    await ConcretizationService.concretizeItem({ itemId: item.id, userId: USER_ID });

    const updated = store.items.find((i) => i.id === item.id)!;
    const meta = updated.metadata as Record<string, unknown>;

    const script =
      (meta.videoScript as string) ?? (meta.reelScript as string) ?? (meta.script as string) ?? '';
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('concretizeItem on an EMAIL_IDEA generates emailSubject + emailBody', async () => {
    const item = seedItem({
      kind: 'EMAIL_IDEA',
      title: 'Welcome series email #1',
      description: 'Email de bienvenue pour les nouveaux abonnés',
      format: 'EMAIL_MARKETING',
    });

    await ConcretizationService.concretizeItem({ itemId: item.id, userId: USER_ID });

    const updated = store.items.find((i) => i.id === item.id)!;
    const meta = updated.metadata as Record<string, unknown>;

    const subject = (meta.emailSubject as string) ?? (meta.subject as string) ?? '';
    const body = (meta.emailBody as string) ?? (meta.body as string) ?? '';
    expect(typeof subject).toBe('string');
    expect(subject.length).toBeGreaterThan(0);
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
  });

  it('regenerateVisual keeps caption, only swaps image', async () => {
    const item = seedItem({
      kind: 'POST_IDEA',
      title: 'Carrousel café',
      description: 'Mini-guide de 5 slides',
      platform: 'INSTAGRAM',
      format: 'INSTAGRAM_CAROUSEL',
    });

    // First, concretize so caption + image exist.
    await ConcretizationService.concretizeItem({ itemId: item.id, userId: USER_ID });
    const afterFirst = store.items.find((i) => i.id === item.id)!;
    const metaFirst = afterFirst.metadata as Record<string, unknown>;
    const captionBefore =
      (metaFirst.caption as string) ?? (metaFirst.copy as string) ?? '';
    const variantsBefore =
      ((metaFirst.imageVariants as unknown[]) ??
        (metaFirst.images as unknown[]) ??
        (metaFirst.visuals as unknown[]) ??
        []) as unknown[];
    expect(captionBefore.length).toBeGreaterThan(0);
    expect(variantsBefore.length).toBeGreaterThanOrEqual(1);

    // Now regenerate only the visual.
    await ConcretizationService.regenerateVisual({ itemId: item.id, userId: USER_ID });

    const afterRegen = store.items.find((i) => i.id === item.id)!;
    const metaRegen = afterRegen.metadata as Record<string, unknown>;
    const captionAfter = (metaRegen.caption as string) ?? (metaRegen.copy as string) ?? '';
    const variantsAfter =
      ((metaRegen.imageVariants as unknown[]) ??
        (metaRegen.images as unknown[]) ??
        (metaRegen.visuals as unknown[]) ??
        []) as unknown[];

    // Caption preserved
    expect(captionAfter).toBe(captionBefore);
    // Image variants present (potentially same length, but at least one)
    expect(variantsAfter.length).toBeGreaterThanOrEqual(1);
  });

  it("markItemReady transitions status to 'ready' in item.metadata", async () => {
    const item = seedItem({
      kind: 'POST_IDEA',
      title: 'Annonce',
      description: 'Annonce simple',
      metadata: { caption: 'Hello world', imageVariants: [{ url: 'https://x/i.png' }] },
    });

    await ConcretizationService.markItemReady({ itemId: item.id, userId: USER_ID });

    const updated = store.items.find((i) => i.id === item.id)!;
    const meta = updated.metadata as Record<string, unknown>;
    expect(meta.status).toBe('ready');
  });
});
