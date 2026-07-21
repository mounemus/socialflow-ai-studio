/**
 * Catalogue des modèles IA disponibles par fournisseur et par catégorie.
 * Source unique pour l'UI de sélection (settings), le registre de capacités
 * et la validation des préférences. Les coûts sont des ordres de grandeur
 * documentés, jamais présentés comme des prix exacts.
 */

export type ModelCategory = 'TEXT' | 'IMAGE' | 'VIDEO';

export interface CatalogModel {
  id: string;
  label: string;
  /** '$' économique · '$$' standard · '$$$' premium */
  costTier: '$' | '$$' | '$$$';
  note?: string;
}

export interface CatalogProvider {
  /** id routeur (claude/gpt/gemini/replicate/stability/dalle) */
  id: string;
  label: string;
  envKey: string;
  models: CatalogModel[];
}

export const MODEL_CATALOG: Record<ModelCategory, CatalogProvider[]> = {
  TEXT: [
    {
      id: 'claude',
      label: 'Anthropic Claude',
      envKey: 'ANTHROPIC_API_KEY',
      models: [
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', costTier: '$$', note: 'raisonnement + rédaction longue' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', costTier: '$', note: 'rapide et économique' },
        { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', costTier: '$$$', note: 'stratégie complexe' },
      ],
    },
    {
      id: 'gpt',
      label: 'OpenAI GPT',
      envKey: 'OPENAI_API_KEY',
      models: [
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', costTier: '$', note: 'copywriting rapide' },
        { id: 'gpt-4o', label: 'GPT-4o', costTier: '$$' },
        { id: 'gpt-4.1', label: 'GPT-4.1', costTier: '$$', note: 'long contexte' },
      ],
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      envKey: 'GOOGLE_GEMINI_API_KEY',
      models: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', costTier: '$', note: 'rapide, multimodal' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', costTier: '$$', note: 'analyse longue' },
      ],
    },
  ],
  IMAGE: [
    {
      id: 'replicate',
      label: 'Replicate (FLUX…)',
      envKey: 'REPLICATE_API_TOKEN',
      models: [
        { id: 'black-forest-labs/flux-schnell', label: 'FLUX Schnell', costTier: '$', note: 'photoréalisme rapide' },
        { id: 'black-forest-labs/flux-dev', label: 'FLUX Dev', costTier: '$$', note: 'meilleure qualité' },
        { id: 'black-forest-labs/flux-1.1-pro', label: 'FLUX 1.1 Pro', costTier: '$$$', note: 'qualité maximale' },
        { id: 'stability-ai/sdxl', label: 'SDXL (Replicate)', costTier: '$' },
      ],
    },
    {
      id: 'dalle',
      label: 'OpenAI Images',
      envKey: 'OPENAI_API_KEY',
      models: [
        { id: 'gpt-image-1', label: 'GPT Image 1', costTier: '$$', note: 'excellent avec du texte dans l’image' },
        { id: 'dall-e-3', label: 'DALL-E 3', costTier: '$$' },
      ],
    },
    {
      id: 'stability',
      label: 'Stability AI',
      envKey: 'STABILITY_API_KEY',
      models: [{ id: 'stable-diffusion-xl-1024-v1-0', label: 'SDXL 1.0', costTier: '$', note: 'fallback visuel' }],
    },
  ],
  VIDEO: [
    {
      id: 'replicate',
      label: 'Replicate (vidéo)',
      envKey: 'REPLICATE_API_TOKEN',
      models: [
        { id: 'wan-video/wan-2.2-t2v-fast', label: 'Wan 2.2 T2V (rapide)', costTier: '$$', note: 'texte → vidéo courte' },
        { id: 'minimax/video-01', label: 'MiniMax Hailuo', costTier: '$$$', note: 'qualité cinématique' },
        { id: 'lightricks/ltx-video', label: 'LTX Video', costTier: '$', note: 'économique' },
      ],
    },
  ],
};

export function findCatalogModel(
  category: ModelCategory,
  provider: string,
  model: string,
): CatalogModel | null {
  const p = MODEL_CATALOG[category].find((x) => x.id === provider);
  return p?.models.find((m) => m.id === model) ?? null;
}

export function providerConfigured(p: CatalogProvider): boolean {
  return !!process.env[p.envKey];
}
