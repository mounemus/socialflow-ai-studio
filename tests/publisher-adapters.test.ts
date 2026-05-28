import { describe, it, expect } from 'vitest';
import { facebookAdapter } from '@/services/publisher/adapters/facebook';
import { instagramAdapter } from '@/services/publisher/adapters/instagram';
import { twitterAdapter } from '@/services/publisher/adapters/twitter';
import { tiktokAdapter } from '@/services/publisher/adapters/tiktok';

const baseInput = {
  postId: 'p1',
  scheduleId: 's1',
  socialAccountId: 'sa1',
  body: 'Hello world',
  hashtags: ['#test'],
  mediaUrls: [] as string[],
};

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

describe('Publisher adapters — mock publish', () => {
  it('Facebook mock publish succeeds and returns mocked external id', async () => {
    const r = await facebookAdapter.publish(baseInput);
    expect(r.success).toBe(true);
    expect(r.mocked).toBe(true);
    expect(r.externalPostId).toBeTruthy();
    expect(r.externalPostId).toContain('mock_facebook_');
  });

  it('Instagram mock publish with media succeeds', async () => {
    const r = await instagramAdapter.publish({ ...baseInput, mediaUrls: ['https://example.com/img.png'] });
    expect(r.success).toBe(true);
  });
});

describe('Publisher adapters — limits', () => {
  it('character limits are correct', () => {
    expect(twitterAdapter.characterLimit()).toBe(280);
    expect(instagramAdapter.characterLimit()).toBe(2200);
    expect(facebookAdapter.characterLimit()).toBe(63206);
  });
});
