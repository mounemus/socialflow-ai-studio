/**
 * Régressions Vague 1 — idempotence de la publication :
 *   1. ACTION_REQUIRED avec identifiant externe = déjà en ligne → jamais republié.
 *   2. PUBLISHING/PROCESSING sans claim → replay concurrent ignoré.
 *   3. Texte [mock] en mode réel → publication refusée (FAILED explicite).
 *   4. publishableMediaUrls saute les placeholders/URL vides et retrouve le
 *      dernier visuel UTILISABLE (une génération ratée ne bloque plus le post).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store: {
  schedule: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
  media: Array<{ id: string; url: string | null; createdAt: Date }>;
} = { schedule: null, updates: [], media: [] };

vi.mock('@/lib/db', () => ({
  db: {
    postSchedule: {
      findUnique: vi.fn(async () => store.schedule),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.updates.push(data);
        return data;
      }),
    },
    mediaAsset: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        store.media.find((m) => m.id === where.id) ?? null),
      findMany: vi.fn(async () =>
        [...store.media].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10)),
    },
  },
}));
vi.mock('@/lib/queue', () => ({ getQueue: vi.fn(), QUEUE_NAMES: { publish: 'publish' } }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn() }));
vi.mock('@/lib/cache', () => ({ invalidate: vi.fn() }));
vi.mock('@/services/gateway/SocialGatewayService', () => ({ SocialGatewayService: {} }));
vi.mock('@/services/publisher/adapters', () => ({ platformAdapters: {} }));
vi.mock('@/services/publisher/adapters/_shared', () => ({ isRealMode: () => true }));

import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { publishableMediaUrls, isPlaceholderVisualUrl } from '@/lib/post-media';

const inputBase = {
  postId: 'post_1',
  scheduleId: 'sched_1',
  socialAccountId: 'acc_1',
  body: 'texte normal',
  hashtags: [] as string[],
  mediaUrls: [] as string[],
};
const input = inputBase as never;

beforeEach(() => {
  store.schedule = null;
  store.updates.length = 0;
  store.media.length = 0;
});

describe('publishNow — gardes anti-doublon', () => {
  it('ACTION_REQUIRED avec externalPostId = déjà en ligne → jamais republié', async () => {
    store.schedule = { id: 'sched_1', status: 'ACTION_REQUIRED', externalPostId: 'ext_42' };
    const r = await SocialPublisherService.publishNow(input);
    expect(r.success).toBe(true);
    expect(r.externalPostId).toBe('ext_42');
    expect(store.updates).toHaveLength(0); // aucun changement d'état, aucun envoi
  });

  it('PUBLISHING sans claim → replay concurrent ignoré', async () => {
    store.schedule = { id: 'sched_1', status: 'PUBLISHING', externalPostId: null };
    const r = await SocialPublisherService.publishNow(input);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/déjà en cours/i);
    expect(store.updates).toHaveLength(0);
  });

  it('texte [mock] en mode réel → refus explicite (FAILED)', async () => {
    store.schedule = { id: 'sched_1', status: 'SCHEDULED', externalPostId: null, socialAccount: { platform: 'INSTAGRAM' } };
    const r = await SocialPublisherService.publishNow({ ...inputBase, body: '[mock] Titre\n\nbrief' } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/\[mock\]/);
    expect(store.updates.some((u) => u.status === 'FAILED')).toBe(true);
  });
});

describe('publishableMediaUrls — placeholders exclus', () => {
  it('détecte les hôtes placeholder', () => {
    expect(isPlaceholderVisualUrl('https://placehold.co/1024x1024/png?text=x')).toBe(true);
    expect(isPlaceholderVisualUrl('https://picsum.photos/seed/a/800')).toBe(true);
    expect(isPlaceholderVisualUrl('')).toBe(true);
    expect(isPlaceholderVisualUrl('https://cdn.fal.media/real.png')).toBe(false);
    expect(isPlaceholderVisualUrl('data:image/png;base64,abc')).toBe(false);
  });

  it('saute la génération ratée récente et publie le vrai visuel plus ancien', async () => {
    store.media = [
      { id: 'm1', url: 'https://storage.app/real.png', createdAt: new Date('2026-08-01') },
      { id: 'm2', url: 'https://placehold.co/1024?text=fail', createdAt: new Date('2026-08-10') },
      { id: 'm3', url: '', createdAt: new Date('2026-08-12') },
    ];
    const urls = await publishableMediaUrls({ id: 'post_1', metadata: {} });
    expect(urls).toEqual(['https://storage.app/real.png']);
  });

  it('une couverture placeholder est ignorée au profit du visuel réel', async () => {
    store.media = [{ id: 'm1', url: 'https://storage.app/real.png', createdAt: new Date() }];
    const urls = await publishableMediaUrls({
      id: 'post_1',
      metadata: { coverUrl: 'https://picsum.photos/seed/x/800' },
    });
    expect(urls).toEqual(['https://storage.app/real.png']);
  });

  it('un CARROUSEL publie toutes ses slides, dans l’ordre de l’éditeur', async () => {
    store.media = [
      { id: 's1', url: 'https://storage.app/slide1.png', createdAt: new Date('2026-08-01') },
      { id: 's2', url: 'https://storage.app/slide2.png', createdAt: new Date('2026-08-02') },
    ];
    const urls = await publishableMediaUrls({
      id: 'post_1',
      format: 'INSTAGRAM_CAROUSEL',
      metadata: { slides: [{ mediaId: 's2' }, { mediaId: 's1' }] },
    });
    expect(urls).toEqual(['https://storage.app/slide2.png', 'https://storage.app/slide1.png']);
  });
});
