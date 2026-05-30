/**
 * Smoke tests for POST /api/posts/produce-batch.
 *
 * Mocks @/lib/db (Prisma client) with an in-memory store — same pattern as
 * tests/brand-pipeline-service.test.ts — and stubs ConcretizationService to
 * return a predictable result so we exercise the route handler logic without
 * touching the AI router / real DB.
 *
 * Covers:
 *   1. POST with 3 valid postIds → all 3 succeed
 *   2. POST with 1 valid + 1 foreign-org postId → 1 ok + 1 dropped (failed
 *      with reason "Post not found in organization")
 *   3. Default provider behavior — when no providers option is sent, the
 *      route still resolves the concretization path and reports `ok`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'user_1';
const ORG_ID = 'org_1';
const FOREIGN_ORG_ID = 'org_2';

interface PostRecord {
  id: string;
  organizationId: string;
  metadata: Record<string, unknown> | null;
}

const store: {
  posts: PostRecord[];
} = { posts: [] };

// ---- Mocks ----------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (_name: string) => undefined,
    set: (_n: string, _v: string) => {},
    delete: (_n: string) => {},
  }),
}));

vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { id: USER_ID } }),
}));

vi.mock('@/lib/db', () => {
  const post = {
    findMany: vi.fn(
      async (args: {
        where: { id?: { in: string[] }; organizationId?: string };
        select?: Record<string, boolean>;
      }) => {
        const ids = args.where.id?.in ?? [];
        const orgFilter = args.where.organizationId;
        return store.posts.filter(
          (p) =>
            ids.includes(p.id) && (orgFilter === undefined || p.organizationId === orgFilter),
        );
      },
    ),
    findFirst: vi.fn(
      async (args: {
        where: { id: string; organizationId?: string };
      }) => {
        return (
          store.posts.find(
            (p) =>
              p.id === args.where.id &&
              (args.where.organizationId === undefined ||
                p.organizationId === args.where.organizationId),
          ) ?? null
        );
      },
    ),
  };

  const teamMember = {
    findUnique: vi.fn(
      async (args: {
        where: { userId_organizationId: { userId: string; organizationId: string } };
      }) => {
        const { userId, organizationId } = args.where.userId_organizationId;
        if (userId === USER_ID && organizationId === ORG_ID) {
          return { userId, organizationId, role: 'OWNER' };
        }
        return null;
      },
    ),
    findFirst: vi.fn(async (args: { where: { userId: string } }) => {
      if (args.where.userId === USER_ID) {
        return { userId: USER_ID, organizationId: ORG_ID, role: 'OWNER' };
      }
      return null;
    }),
  };

  return { db: { post, teamMember } };
});

const concretizeItemMock = vi.fn(
  async (opts: { itemId: string; userId?: string; forceProvider?: string }) => ({
    itemId: opts.itemId,
    postId: `post_for_${opts.itemId}`,
    variants: [
      {
        url: 'https://placehold.co/1024x1024/png?text=mock',
        prompt: 'mock prompt',
        provider: opts.forceProvider ?? 'gemini',
        mocked: true,
      },
    ],
    caption: 'mock caption',
    hashtags: ['#mock'],
    cta: 'Learn more',
    provider: opts.forceProvider ?? 'gemini',
    mocked: true,
    status: 'producing' as const,
    aspectRatio: '1:1' as const,
  }),
);

vi.mock('@/services/concretization/ConcretizationService', () => ({
  ConcretizationService: {
    concretizeItem: concretizeItemMock,
  },
}));

// Stub ContentProductionService too — fallback path should not be hit in the
// happy-path tests (every post points to a strategy item), but keep it safe.
vi.mock('@/services/production/ContentProductionService', () => ({
  ContentProductionService: {
    produceVisualsForPost: vi.fn(async () => ({ variants: [], canvaDesign: undefined })),
    produceVideoScriptForPost: vi.fn(async () => ({
      script: '',
      hook: '',
      scenes: [],
      mocked: true,
    })),
    persistProducedAssets: vi.fn(async () => ({ assetIds: [] })),
  },
}));

// Import the route handler AFTER the mocks are registered.
const { POST } = await import('@/app/api/posts/produce-batch/route');

// ---- Helpers --------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/posts/produce-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPost(body: unknown) {
  const res = await POST(makeRequest(body), { params: Promise.resolve({}) });
  return {
    status: res.status,
    json: (await res.json()) as {
      data?: {
        results: Array<{ postId: string; status: 'ok' | 'failed'; error?: string; variantsCount?: number }>;
        summary: { total: number; ok: number; failed: number };
      };
      error?: string;
      message?: string;
    },
  };
}

function seedPost(id: string, organizationId: string, withStrategyItem = true): void {
  store.posts.push({
    id,
    organizationId,
    metadata: withStrategyItem ? { fromStrategyItem: `item_${id}` } : {},
  });
}

// ---- Tests ----------------------------------------------------------------

describe('POST /api/posts/produce-batch', () => {
  beforeEach(() => {
    store.posts = [];
    concretizeItemMock.mockClear();
  });

  it('processes 3 valid postIds and reports all 3 as ok', async () => {
    seedPost('p1', ORG_ID);
    seedPost('p2', ORG_ID);
    seedPost('p3', ORG_ID);

    const { status, json } = await callPost({ postIds: ['p1', 'p2', 'p3'] });

    expect(status).toBe(200);
    expect(json.data).toBeDefined();
    expect(json.data!.summary).toEqual({ total: 3, ok: 3, failed: 0 });
    expect(json.data!.results).toHaveLength(3);

    const okIds = json.data!.results.filter((r) => r.status === 'ok').map((r) => r.postId).sort();
    expect(okIds).toEqual(['p1', 'p2', 'p3']);

    // Each ok entry must report at least one variant (the mock returns 1)
    for (const r of json.data!.results) {
      expect(r.status).toBe('ok');
      expect(r.variantsCount).toBe(1);
      expect(r.error).toBeUndefined();
    }

    // ConcretizationService.concretizeItem should have been invoked for each post
    expect(concretizeItemMock).toHaveBeenCalledTimes(3);
    const calledItemIds = concretizeItemMock.mock.calls.map((c) => c[0].itemId).sort();
    expect(calledItemIds).toEqual(['item_p1', 'item_p2', 'item_p3']);
  });

  it('drops foreign-org postIds: 1 valid + 1 foreign → 1 ok + 1 dropped', async () => {
    seedPost('mine', ORG_ID);
    seedPost('theirs', FOREIGN_ORG_ID); // belongs to another org

    const { status, json } = await callPost({ postIds: ['mine', 'theirs'] });

    expect(status).toBe(200);
    expect(json.data!.summary.total).toBe(2);
    expect(json.data!.summary.ok).toBe(1);
    expect(json.data!.summary.failed).toBe(1);

    const okEntry = json.data!.results.find((r) => r.status === 'ok');
    const failedEntry = json.data!.results.find((r) => r.status === 'failed');

    expect(okEntry?.postId).toBe('mine');
    expect(failedEntry?.postId).toBe('theirs');
    // The foreign post must be reported as not found in the org, not run
    // through concretizeItem.
    expect(failedEntry?.error).toMatch(/not found in organization/i);

    expect(concretizeItemMock).toHaveBeenCalledTimes(1);
    expect(concretizeItemMock.mock.calls[0][0].itemId).toBe('item_mine');
  });

  it('uses default provider behavior when no providers option is sent', async () => {
    seedPost('p1', ORG_ID);

    const { status, json } = await callPost({ postIds: ['p1'] });

    expect(status).toBe(200);
    expect(json.data!.summary.ok).toBe(1);
    expect(concretizeItemMock).toHaveBeenCalledTimes(1);

    // The route's default-providers list is ['gemini']. The route passes the
    // FIRST entry of providers to ConcretizationService as `forceProvider`.
    // So forceProvider must be 'gemini' for the default-options call.
    const callArgs = concretizeItemMock.mock.calls[0][0];
    expect(callArgs.forceProvider).toBe('gemini');
    expect(callArgs.itemId).toBe('item_p1');
    expect(callArgs.userId).toBe(USER_ID);
  });
});
