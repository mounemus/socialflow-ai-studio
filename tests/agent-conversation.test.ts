import { describe, it, expect } from 'vitest';
import { condenseAgentMessages } from '@/services/agent/ClaudeAgentService';

describe('condenseAgentMessages — mémoire de conversation depuis la DB', () => {
  it('extrait les tours user/assistant en texte simple', () => {
    const trace = [
      { role: 'user', content: 'Crée une marque UbSkilled JobHunter' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Je lance la création.' },
          { type: 'tool_use', id: 't1', name: 'onboard_brand', input: {} },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"brandId":"b_ub"}' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Marque UbSkilled créée (brandId b_ub).' }],
      },
    ];
    const h = condenseAgentMessages(trace);
    expect(h).toEqual([
      { role: 'user', content: 'Crée une marque UbSkilled JobHunter' },
      { role: 'assistant', content: 'Je lance la création.' },
      { role: 'assistant', content: 'Marque UbSkilled créée (brandId b_ub).' },
    ]);
    // Le contexte "cette marque" (brandId b_ub) survit au tour suivant.
    expect(JSON.stringify(h)).toContain('b_ub');
  });

  it('ignore les blocs outils sans texte (pas de paires tool_use orphelines rejouées)', () => {
    const trace = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
    ];
    expect(condenseAgentMessages(trace)).toEqual([]);
  });

  it('tolère les traces vides/invalides', () => {
    expect(condenseAgentMessages(null)).toEqual([]);
    expect(condenseAgentMessages([])).toEqual([]);
    expect(condenseAgentMessages('junk')).toEqual([]);
  });

  it('plafonne l’historique aux derniers messages', () => {
    const trace = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const h = condenseAgentMessages(trace, 20);
    expect(h).toHaveLength(20);
    expect(h[19].content).toBe('m59');
  });
});
