/**
 * Régression « Programmer publie immédiatement » : sans REDIS_URL, enqueue()
 * publiait TOUT DE SUITE même pour un créneau futur. Désormais un créneau
 * futur (> 90 s) est laissé au cron publish-due ; seuls « maintenant » et les
 * créneaux passés partent en synchrone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({ getQueue: vi.fn(), QUEUE_NAMES: { publish: 'publish' } }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn() }));
vi.mock('@/lib/cache', () => ({ invalidate: vi.fn() }));
vi.mock('@/services/gateway/SocialGatewayService', () => ({ SocialGatewayService: {} }));
vi.mock('@/services/publisher/adapters', () => ({ platformAdapters: {} }));
vi.mock('@/services/publisher/adapters/_shared', () => ({ isRealMode: () => false }));
vi.mock('@/lib/post-media', () => ({ publishableMediaUrls: vi.fn(async () => []) }));
vi.mock('@/lib/social-text', () => ({ sanitizeSocialText: (s: string) => s }));

import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';

const input = {
  postId: 'post_1',
  scheduleId: 'sched_1',
  socialAccountId: 'acc_1',
  body: 'texte',
  hashtags: [],
  mediaUrls: [],
  scheduledFor: new Date(),
} as never;

describe('SocialPublisherService.enqueue sans Redis', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    delete process.env.REDIS_URL;
    publishSpy = vi
      .spyOn(SocialPublisherService, 'publishNow')
      .mockResolvedValue({ success: true, simulated: true, mocked: true } as never);
  });
  afterEach(() => {
    publishSpy.mockRestore();
  });

  it('créneau FUTUR → aucune publication immédiate (le cron publish-due prend le relais)', async () => {
    const inOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const res = await SocialPublisherService.enqueue(input, inOneDay);
    expect(publishSpy).not.toHaveBeenCalled();
    expect(res.jobId).toBeNull();
  });

  it('créneau immédiat ou passé → publication synchrone', async () => {
    await SocialPublisherService.enqueue(input, new Date(Date.now() - 1000));
    expect(publishSpy).toHaveBeenCalledTimes(1);
    await SocialPublisherService.enqueue(input);
    expect(publishSpy).toHaveBeenCalledTimes(2);
  });
});
