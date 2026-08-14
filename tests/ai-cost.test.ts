import { describe, it, expect } from 'vitest';
import { estimateAiCostCents } from '@/lib/ai-cost';

// Le garde-fou budgétaire ne fonctionne que si chaque appel IA a un coût > 0.
describe('estimateAiCostCents', () => {
  it('tout appel réel coûte au moins 1 centime', () => {
    for (const kind of ['TEXT', 'IMAGE', 'VIDEO'] as const) {
      for (const provider of ['fal', 'dalle', 'gemini', 'stability', 'claude', 'inconnu', null]) {
        expect(estimateAiCostCents(kind, provider)).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('les mocks coûtent 0', () => {
    expect(estimateAiCostCents('IMAGE', 'mock')).toBe(0);
    expect(estimateAiCostCents('TEXT', 'mock')).toBe(0);
  });
  it('la vidéo est l’appel le plus cher', () => {
    expect(estimateAiCostCents('VIDEO', 'fal')).toBeGreaterThan(estimateAiCostCents('IMAGE', 'dalle'));
  });
});
