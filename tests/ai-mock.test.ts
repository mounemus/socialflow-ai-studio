import { describe, it, expect } from 'vitest';
import { mockAdapter } from '@/services/ai/adapters/mock';

describe('AI mock adapter', () => {
  it('generates text in FR by default', async () => {
    const r = await mockAdapter.generateText({ prompt: 'test prompt' });
    expect(r.text).toBeTruthy();
    expect(r.mocked).toBe(true);
    expect(r.provider).toBe('mock');
    expect(r.text.toLowerCase()).toContain('mock');
  });

  it('respects English language', async () => {
    const r = await mockAdapter.generateText({ prompt: 'hi', language: 'en' });
    expect(r.text).toContain('Here is a proposal');
  });

  it('mixes brand hashtags + sample hashtags', async () => {
    const r = await mockAdapter.generateText({
      prompt: 'launch',
      brandContext: {
        name: 'Acme',
        officialHashtags: ['#acme'],
      },
    });
    expect(r.hashtags).toContain('#acme');
    expect((r.hashtags ?? []).length).toBeGreaterThan(1);
  });

  it('generates a placeholder image URL', async () => {
    const r = await mockAdapter.generateImage!({ prompt: 'a cat' });
    expect(r.url).toContain('picsum.photos');
    expect(r.mocked).toBe(true);
  });
});
