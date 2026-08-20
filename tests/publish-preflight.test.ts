import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    mediaAsset: {
      findMany: vi.fn(async () => []),
    },
  },
}));

import { assertTextFor, characterLimitFor, messageLength, preflightPost } from '@/lib/publish-preflight';
import { db } from '@/lib/db';

describe('characterLimitFor / messageLength', () => {
  it('limites par plateforme (adaptateurs), null si inconnue', () => {
    expect(characterLimitFor('TWITTER')).toBe(280);
    expect(characterLimitFor('INSTAGRAM')).toBe(2200);
    expect(characterLimitFor(null)).toBeNull();
    expect(characterLimitFor('MYSPACE')).toBeNull();
  });
  it('longueur = corps + hashtags joints par espace (même règle que basicValidate)', () => {
    expect(messageLength('abc', ['#a', '#b'])).toBe(3 + 5);
  });
});

describe('assertTextFor', () => {
  it('refuse un texte au-delà de la limite, accepte en-deçà', () => {
    expect(() => assertTextFor('TWITTER', 'x'.repeat(300), [])).toThrow(/280/);
    expect(() => assertTextFor('TWITTER', 'x'.repeat(200), [])).not.toThrow();
    expect(() => assertTextFor(null, 'x'.repeat(99999), [])).not.toThrow();
  });
});

describe('preflightPost', () => {
  const base = { id: 'p1', hashtags: [] as string[] };
  it('texte trop long → error ; média manquant Instagram → error', async () => {
    const issues = await preflightPost({ ...base, body: 'x'.repeat(3000), format: 'INSTAGRAM_POST' }, 'INSTAGRAM');
    expect(issues.some((i) => i.level === 'error' && /caractères/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === 'error' && /visuel/.test(i.message))).toBe(true);
  });
  it('format vidéo sans vidéo mais avec image → warning « une IMAGE partira »', async () => {
    vi.mocked(db.mediaAsset.findMany).mockResolvedValueOnce([
      { id: 'm1', url: 'https://x/y.png', kind: 'IMAGE', mimeType: 'image/png', sizeBytes: 1000 },
    ] as never);
    const issues = await preflightPost({ ...base, body: 'ok', format: 'INSTAGRAM_REEL' }, 'INSTAGRAM');
    expect(issues.some((i) => i.level === 'warning' && /IMAGE partira/.test(i.message))).toBe(true);
  });
  it('vidéo trop lourde → warning taille', async () => {
    vi.mocked(db.mediaAsset.findMany).mockResolvedValueOnce([
      { id: 'm1', url: 'https://x/v.mp4', kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 200 * 1024 * 1024 },
    ] as never);
    const issues = await preflightPost({ ...base, body: 'ok', format: 'INSTAGRAM_REEL' }, 'INSTAGRAM');
    expect(issues.some((i) => i.level === 'warning' && /Mo/.test(i.message))).toBe(true);
  });
  it('tout est bon → aucune erreur', async () => {
    vi.mocked(db.mediaAsset.findMany).mockResolvedValueOnce([
      { id: 'm1', url: 'https://x/v.mp4', kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 10 * 1024 * 1024 },
    ] as never);
    const issues = await preflightPost({ ...base, body: 'ok', format: 'INSTAGRAM_REEL' }, 'INSTAGRAM');
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
