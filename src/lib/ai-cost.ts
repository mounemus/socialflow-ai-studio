/**
 * Estimation de coût des appels IA, en CENTIMES — alimente AIRequest.costCents,
 * la seule donnée que lit le garde-fou budgétaire (AgentGuardrailService).
 * Avant : costCents n'était écrit NULLE PART → dépense comptée 0 → la limite
 * mensuelle ne refusait jamais rien.
 *
 * Ordres de grandeur volontairement conservateurs (arrondis au centime sup.) —
 * mieux vaut freiner un peu tôt que jamais.
 */
export function estimateAiCostCents(
  kind: 'TEXT' | 'IMAGE' | 'VIDEO',
  provider?: string | null,
): number {
  const p = (provider ?? '').toLowerCase();
  if (kind === 'VIDEO') return 50;
  if (kind === 'IMAGE') {
    if (p.includes('fal') || p.includes('flux') || p.includes('replicate')) return 1;
    if (p.includes('gemini') || p.includes('nano')) return 1;
    if (p.includes('dalle') || p.includes('dall-e') || p.includes('gpt-image') || p.includes('openai')) return 4;
    if (p.includes('stability')) return 4;
    if (p.includes('mock')) return 0;
    return 3;
  }
  // TEXT
  if (p.includes('mock')) return 0;
  return 1;
}
