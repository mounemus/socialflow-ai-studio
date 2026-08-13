/**
 * Régressions Phase 1 de la refonte « Post = source de vérité » :
 *   1. syncPostToStrategyItem reflète body/hashtags/cta/visuels du Post dans
 *      item.metadata.concretization (le pipeline affiche ce qui partira).
 *   2. Les visuels existants ne sont PAS effacés quand le post n'a pas de média.
 *   3. executeItem RÉUTILISE le Post concrétisé (pas de second post, postId
 *      conservé) et ne crée pas de créneau en double.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface PostRec {
  id: string;
  organizationId: string;
  body: string | null;
  hashtags: string[];
  cta: string | null;
  status: string;
  metadata: Record<string, unknown>;
  media: Array<{ url: string; kind: string }>;
}
interface ItemRec {
  id: string;
  strategyId: string;
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
  strategy?: unknown;
}

const store: {
  posts: PostRec[];
  items: ItemRec[];
  schedules: Array<{ id: string; postId: string; scheduledFor: Date; shareMode: string }>;
  seq: number;
} = { posts: [], items: [], schedules: [], seq: 0 };

const strategyRow = {
  id: 'strat_1',
  organizationId: 'org_1',
  brandId: 'brand_1',
  strategy: null,
  brand: { id: 'brand_1', name: 'Acme', profile: null },
};

vi.mock('@/lib/db', () => {
  const db = {
    post: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        store.posts.find((p) => p.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.seq += 1;
        const rec: PostRec = {
          id: `post_${store.seq}`,
          organizationId: String(data.organizationId),
          body: (data.body as string) ?? null,
          hashtags: (data.hashtags as string[]) ?? [],
          cta: (data.cta as string) ?? null,
          status: String(data.status ?? 'DRAFT'),
          metadata: (data.metadata as Record<string, unknown>) ?? {},
          media: [],
        };
        store.posts.push(rec);
        return rec;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = store.posts.find((x) => x.id === where.id);
        if (!p) throw new Error('post not found');
        if (data.status) p.status = String(data.status);
        if (data.body !== undefined) p.body = data.body as string;
        return p;
      }),
    },
    strategyItem: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const it = store.items.find((i) => i.id === where.id) ?? null;
        if (!it) return null;
        return { ...it, strategy: strategyRow };
      }),
      findFirst: vi.fn(async ({ where }: { where: { postId?: string } }) =>
        store.items.find((i) => i.postId === where.postId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ItemRec> }) => {
        const idx = store.items.findIndex((i) => i.id === where.id);
        if (idx < 0) throw new Error('item not found');
        store.items[idx] = { ...store.items[idx], ...data } as ItemRec;
        return store.items[idx];
      }),
    },
    postSchedule: {
      findFirst: vi.fn(async ({ where }: { where: { postId: string } }) =>
        store.schedules.find((s) => s.postId === where.postId) ?? null),
      create: vi.fn(async ({ data }: { data: { postId: string; scheduledFor: Date; shareMode: string } }) => {
        store.seq += 1;
        const rec = { id: `sched_${store.seq}`, ...data };
        store.schedules.push(rec);
        return rec;
      }),
    },
    socialAccount: {
      findFirst: vi.fn(async () => null),
    },
    watchReport: {
      findMany: vi.fn(async () => []),
    },
  };
  return { db };
});

vi.mock('@/services/ai/AIProviderService', () => ({
  AIProviderService: {
    generateText: vi.fn(async () => ({ text: '[IA] texte régénéré', mocked: false, hashtags: [] })),
  },
}));
vi.mock('@/services/ai/AIRouterService', () => ({ AIRouterService: {} }));

import { syncPostToStrategyItem } from '@/lib/post-item-sync';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';

beforeEach(() => {
  store.posts.length = 0;
  store.items.length = 0;
  store.schedules.length = 0;
  store.seq = 0;
  vi.clearAllMocks(); // compteurs d'appels remis à zéro entre tests
});

describe('syncPostToStrategyItem (Post = source de vérité)', () => {
  it('reflète body/hashtags/visuels du Post dans item.metadata.concretization', async () => {
    store.posts.push({
      id: 'post_a', organizationId: 'org_1', body: 'Texte édité au Studio',
      hashtags: ['#new'], cta: 'Go', status: 'DRAFT', metadata: {},
      media: [{ url: 'https://cdn/img.png', kind: 'IMAGE' }, { url: 'https://cdn/v.mp4', kind: 'VIDEO' }],
    });
    store.items.push({
      id: 'item_a', strategyId: 'strat_1', kind: 'POST_IDEA', status: 'APPROVED',
      title: 'T', description: 'D', platform: null, format: null, suggestedDate: null,
      hashtags: [], cta: null, postId: 'post_a', campaignId: null,
      metadata: { concretization: { caption: 'ancienne caption', imageUrls: ['old.png'], status: 'producing' } },
    });

    await syncPostToStrategyItem('post_a');

    const meta = store.items[0].metadata as { concretization: Record<string, unknown>; caption?: string };
    expect(meta.concretization.caption).toBe('Texte édité au Studio');
    expect(meta.caption).toBe('Texte édité au Studio');
    expect(meta.concretization.hashtags).toEqual(['#new']);
    expect(meta.concretization.imageUrls).toEqual(['https://cdn/img.png']); // pas la vidéo
    expect(meta.concretization.status).toBe('producing'); // statut préservé
  });

  it("ne touche pas aux visuels de l'item quand le post n'a pas de média", async () => {
    store.posts.push({
      id: 'post_b', organizationId: 'org_1', body: 'txt', hashtags: [], cta: null,
      status: 'DRAFT', metadata: {}, media: [],
    });
    store.items.push({
      id: 'item_b', strategyId: 'strat_1', kind: 'POST_IDEA', status: 'APPROVED',
      title: 'T', description: 'D', platform: null, format: null, suggestedDate: null,
      hashtags: [], cta: null, postId: 'post_b', campaignId: null,
      metadata: { concretization: { imageUrls: ['keep.png'] } },
    });

    await syncPostToStrategyItem('post_b');
    const meta = store.items[0].metadata as { concretization: Record<string, unknown> };
    expect(meta.concretization.imageUrls).toEqual(['keep.png']);
  });

  it('ne jette jamais (post inexistant)', async () => {
    await expect(syncPostToStrategyItem('nope')).resolves.toBeUndefined();
  });
});

describe('executeItem réutilise le Post concrétisé', () => {
  it('ne crée NI second post NI second créneau, et conserve item.postId', async () => {
    store.posts.push({
      id: 'post_c', organizationId: 'org_1', body: 'Caption validée à l’Acte 4',
      hashtags: ['#ok'], cta: null, status: 'PENDING_APPROVAL', metadata: {}, media: [],
    });
    store.items.push({
      id: 'item_c', strategyId: 'strat_1', kind: 'POST_IDEA', status: 'APPROVED',
      title: 'T', description: 'brief brut', platform: 'INSTAGRAM', format: 'INSTAGRAM_POST',
      suggestedDate: new Date('2026-09-01T10:00:00Z'), hashtags: [], cta: null,
      postId: 'post_c', campaignId: null, metadata: {},
    });

    const res = await MarketingStrategyService.executeItem('item_c', 'org_1', 'user_1');

    expect(res.postId).toBe('post_c');
    expect(store.posts).toHaveLength(1); // pas de post fantôme
    expect(store.items[0].postId).toBe('post_c'); // lien conservé
    expect(store.posts[0].body).toBe('Caption validée à l’Acte 4'); // texte non régénéré
    expect(store.schedules).toHaveLength(1);

    // Ré-exécution (idempotence) : pas de doublon de créneau.
    store.items[0].status = 'APPROVED';
    await MarketingStrategyService.executeItem('item_c', 'org_1', 'user_1');
    expect(store.schedules).toHaveLength(1);
  });

  it('sans post lié, la caption CONCRÉTISÉE prime sur la régénération depuis le brief', async () => {
    // Cas « purge » : posts supprimés avec l'ancien pipeline, mais le travail
    // de concrétisation vit dans metadata — le brief brut ne doit JAMAIS
    // devenir le texte publié.
    store.items.push({
      id: 'item_e', strategyId: 'strat_1', kind: 'POST_IDEA', status: 'APPROVED',
      title: 'T', description: 'brief brut (prompt)', platform: null, format: 'LINKEDIN_POST',
      suggestedDate: null, hashtags: [], cta: null, postId: null, campaignId: null,
      metadata: { concretization: { caption: 'Caption finale validée ✨', hashtags: ['#final'] } },
    });

    const res = await MarketingStrategyService.executeItem('item_e', 'org_1', 'user_1');
    const post = store.posts.find((p) => p.id === res.postId)!;
    expect(post.body).toBe('Caption finale validée ✨');
    expect(post.hashtags).toEqual(['#final']);
  });

  it("crée un post normalement pour un item jamais concrétisé", async () => {
    store.items.push({
      id: 'item_d', strategyId: 'strat_1', kind: 'POST_IDEA', status: 'APPROVED',
      title: 'T', description: 'brief', platform: null, format: 'INSTAGRAM_POST',
      suggestedDate: null, hashtags: [], cta: null, postId: null, campaignId: null, metadata: {},
    });

    const res = await MarketingStrategyService.executeItem('item_d', 'org_1', 'user_1');
    expect(res.postId).toBeTruthy();
    expect(store.posts).toHaveLength(1);
    expect(store.items[0].postId).toBe(res.postId);
    expect(db.post.create).toHaveBeenCalledTimes(1);
  });
});
