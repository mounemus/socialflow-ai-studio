import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { falAdapter } from '@/services/ai/adapters/fal';

/**
 * Régression "fal: réponse sans vidéo (405)" — le résultat de l'API queue fal
 * se lit sur GET .../requests/{id} (SANS suffixe /response). L'ancien polling
 * ajoutait /response et échouait en 405 alors que la vidéo était générée.
 */
describe('falAdapter.getVideoPrediction', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.FAL_KEY = 'test-key';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FAL_KEY;
  });

  it('lit le résultat sur .../requests/{id} sans suffixe /response', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/status')) {
        return { ok: true, json: async () => ({ status: 'COMPLETED' }) };
      }
      expect(url).toBe('https://queue.fal.run/fal-ai/seedance-2.5/requests/req-1');
      return { ok: true, json: async () => ({ video: { url: 'https://cdn.fal.ai/out.mp4' } }) };
    });

    const p = await falAdapter.getVideoPrediction('req-1', 'fal-ai/seedance-2.5/text-to-video');
    expect(p.status).toBe('succeeded');
    expect(p.outputUrl).toBe('https://cdn.fal.ai/out.mp4');
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes('/response'))).toBe(false);
  });

  it('reste en processing tant que la file répond IN_PROGRESS', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'IN_PROGRESS' }) });
    const p = await falAdapter.getVideoPrediction('req-2', 'fal-ai/seedance-2.5/text-to-video');
    expect(p.status).toBe('processing');
  });
});
