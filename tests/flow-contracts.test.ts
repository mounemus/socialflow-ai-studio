import { describe, it, expect } from 'vitest';
import { flowGraph, defaultGraph, canConnect, createFlowInput } from '@/lib/contracts/flow';

describe('contrats du flux nodal', () => {
  it('valide le graphe par défaut Brief → Texte → Visuel → Publication', () => {
    const g = defaultGraph('brand_1');
    const parsed = flowGraph.safeParse(g);
    expect(parsed.success).toBe(true);
    expect(g.nodes.map((n) => n.kind)).toEqual(['brief', 'text', 'image', 'publication']);
    expect(g.edges).toHaveLength(3);
  });

  it('n’autorise que des connexions qui s’exécutent', () => {
    expect(canConnect('brief', 'text')).toBe(true);
    expect(canConnect('text', 'image')).toBe(true);
    expect(canConnect('image', 'publication')).toBe(true);
    // Une publication ne produit rien en aval, un texte ne nourrit pas un brief.
    expect(canConnect('publication', 'text')).toBe(false);
    expect(canConnect('text', 'brief')).toBe(false);
  });

  it('rejette un graphe mal formé', () => {
    expect(flowGraph.safeParse({ nodes: [{ id: 'a', kind: 'inconnu', position: { x: 0, y: 0 } }], edges: [] }).success).toBe(false);
    expect(flowGraph.safeParse({ nodes: [], edges: [{ id: 'e', source: 'a' }] }).success).toBe(false);
  });

  it('accepte la charge de création d’un flux', () => {
    const res = createFlowInput.safeParse({ name: 'Recette LinkedIn', graph: defaultGraph() });
    expect(res.success).toBe(true);
  });
});
