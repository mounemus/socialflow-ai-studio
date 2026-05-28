import { describe, it, expect } from 'vitest';
import { MarketingWatchService } from '@/services/watch/MarketingWatchService';

describe('MarketingWatchService.scoreItem', () => {
  it('higher relevance when keywords match', () => {
    const high = MarketingWatchService.scoreItem(
      { title: 'AI in marketing', summary: 'Marketing strategy with AI tools' },
      ['ai', 'marketing'],
    );
    const low = MarketingWatchService.scoreItem(
      { title: 'Cooking recipe', summary: 'How to make pasta' },
      ['ai', 'marketing'],
    );
    expect(high.relevanceScore).toBeGreaterThan(low.relevanceScore);
  });

  it('recent items score higher on trendScore', () => {
    const recent = MarketingWatchService.scoreItem({
      title: 'x', publishedAt: new Date(),
    });
    const old = MarketingWatchService.scoreItem({
      title: 'x', publishedAt: new Date(Date.now() - 30 * 86_400_000),
    });
    expect(recent.trendScore).toBeGreaterThan(old.trendScore);
  });

  it('all scores are 0-1 range', () => {
    const s = MarketingWatchService.scoreItem({ title: 'test' }, ['nope']);
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
