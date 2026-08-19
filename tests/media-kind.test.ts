import { describe, it, expect } from 'vitest';
import { isVideoFormat, isVideoMedia } from '@/lib/media-kind';

describe('isVideoMedia', () => {
  it('reconnaît kind (Prisma), l’alias type, le mimeType et l’extension', () => {
    expect(isVideoMedia({ url: 'x', kind: 'VIDEO' })).toBe(true);
    expect(isVideoMedia({ url: 'x', type: 'video' })).toBe(true);
    expect(isVideoMedia({ url: 'x', mimeType: 'video/mp4' })).toBe(true);
    expect(isVideoMedia({ url: 'https://v3.fal.media/files/a/out.mp4?sig=1' })).toBe(true);
  });
  it('image → false (même sans kind)', () => {
    expect(isVideoMedia({ url: 'https://x/y.png', kind: 'IMAGE' })).toBe(false);
    expect(isVideoMedia({ url: 'https://x/y.jpg' })).toBe(false);
  });
});

describe('isVideoFormat', () => {
  it('Reel/Story/TikTok/Short = vidéo, POST = non', () => {
    expect(isVideoFormat('INSTAGRAM_REEL')).toBe(true);
    expect(isVideoFormat('TIKTOK_VIDEO')).toBe(true);
    expect(isVideoFormat('INSTAGRAM_POST')).toBe(false);
    expect(isVideoFormat(null)).toBe(false);
  });
});
