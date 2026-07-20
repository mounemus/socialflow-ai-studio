import { afterEach, describe, it, expect } from 'vitest';
import { facebookAdapter } from '@/services/publisher/adapters/facebook';
import { instagramAdapter } from '@/services/publisher/adapters/instagram';
import { linkedinAdapter } from '@/services/publisher/adapters/linkedin';
import { twitterAdapter } from '@/services/publisher/adapters/twitter';
import { tiktokAdapter } from '@/services/publisher/adapters/tiktok';
import { youtubeAdapter } from '@/services/publisher/adapters/youtube';
import { pinterestAdapter } from '@/services/publisher/adapters/pinterest';

const baseInput = {
  postId: 'p1',
  scheduleId: 's1',
  socialAccountId: 'sa1',
  body: 'Hello world',
  hashtags: ['#test'],
  mediaUrls: [] as string[],
};

afterEach(() => {
  delete process.env.ENABLE_REAL_PUBLISHING;
});

describe('Publisher adapters — validation', () => {
  it('Instagram requires media', () => {
    expect(instagramAdapter.validate(baseInput).ok).toBe(false);
    expect(instagramAdapter.validate({ ...baseInput, mediaUrls: ['x'] }).ok).toBe(true);
  });

  it('TikTok requires media', () => {
    expect(tiktokAdapter.validate(baseInput).ok).toBe(false);
  });

  it('Twitter rejects long bodies (>280)', () => {
    const body = 'x'.repeat(290);
    expect(twitterAdapter.validate({ ...baseInput, body }).ok).toBe(false);
  });

  it('Facebook accepts long body (63206 char limit)', () => {
    expect(facebookAdapter.validate({ ...baseInput, body: 'a'.repeat(1000) }).ok).toBe(true);
  });
});

describe('Publisher adapters — simulation mode (default)', () => {
  it('returns simulated=true with NO external id and NO url', async () => {
    const r = await facebookAdapter.publish(baseInput);
    expect(r.success).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.mocked).toBe(true); // deprecated alias
    expect(r.externalPostId).toBeUndefined();
    expect(r.externalUrl).toBeUndefined();
  });

  it('every adapter simulates without fabricating identifiers', async () => {
    const adapters = [
      facebookAdapter,
      instagramAdapter,
      linkedinAdapter,
      twitterAdapter,
      tiktokAdapter,
      youtubeAdapter,
      pinterestAdapter,
    ];
    for (const a of adapters) {
      const r = await a.publish({ ...baseInput, mediaUrls: ['https://example.com/img.png'] });
      expect(r.simulated).toBe(true);
      expect(r.externalPostId).toBeUndefined();
    }
  });
});

describe('Publisher adapters — real mode honesty', () => {
  it('unimplemented platforms fail with NOT_IMPLEMENTED instead of faking success', async () => {
    process.env.ENABLE_REAL_PUBLISHING = 'true';
    for (const a of [twitterAdapter, tiktokAdapter, youtubeAdapter, pinterestAdapter]) {
      const r = await a.publish({ ...baseInput, mediaUrls: ['https://example.com/v.mp4'] });
      expect(r.success).toBe(false);
      expect(r.simulated).toBe(false);
      expect(r.errorCode).toBe('NOT_IMPLEMENTED');
      expect(r.externalPostId).toBeUndefined();
    }
  });

  it('implemented platforms fail with NO_TOKEN when no context token is provided', async () => {
    process.env.ENABLE_REAL_PUBLISHING = 'true';
    for (const a of [facebookAdapter, instagramAdapter, linkedinAdapter]) {
      const r = await a.publish({ ...baseInput, mediaUrls: ['https://example.com/img.png'] });
      expect(r.success).toBe(false);
      expect(r.errorCode).toBe('NO_TOKEN');
    }
  });

  it('supportsRealPublishing flags match implementation state', () => {
    expect(facebookAdapter.supportsRealPublishing).toBe(true);
    expect(instagramAdapter.supportsRealPublishing).toBe(true);
    expect(linkedinAdapter.supportsRealPublishing).toBe(true);
    expect(twitterAdapter.supportsRealPublishing).toBe(false);
    expect(tiktokAdapter.supportsRealPublishing).toBe(false);
    expect(youtubeAdapter.supportsRealPublishing).toBe(false);
    expect(pinterestAdapter.supportsRealPublishing).toBe(false);
  });
});

describe('Publisher adapters — limits', () => {
  it('character limits are correct', () => {
    expect(twitterAdapter.characterLimit()).toBe(280);
    expect(instagramAdapter.characterLimit()).toBe(2200);
    expect(facebookAdapter.characterLimit()).toBe(63206);
  });
});
