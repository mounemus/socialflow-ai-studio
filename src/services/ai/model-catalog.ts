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
  /** id routeur (claude/gpt/gemini/replicate/stability/dalle/fal) */
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
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', costTier: '$$', note: 'nouvelle génération — codage et agents' },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', costTier: '$$$', note: 'stratégie complexe, long-horizon' },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', costTier: '$$', note: 'raisonnement + rédaction longue' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', costTier: '$', note: 'rapide et économique' },
      ],
    },
    {
      id: 'gpt',
      label: 'OpenAI GPT',
      envKey: 'OPENAI_API_KEY',
      models: [
        { id: 'gpt-5-mini', label: 'GPT-5 mini', costTier: '$', note: 'copywriting rapide' },
        { id: 'gpt-5', label: 'GPT-5', costTier: '$$', note: 'dernière génération' },
        { id: 'gpt-4o', label: 'GPT-4o', costTier: '$$' },
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', costTier: '$', note: 'économique (legacy)' },
      ],
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      envKey: 'GOOGLE_GEMINI_API_KEY',
      models: [
        { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', costTier: '$$', note: 'dernier — agentique + multimodal' },
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', costTier: '$$', note: 'très intelligent, codage' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', costTier: '$$', note: 'analyse longue (1M tokens)' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', costTier: '$', note: 'rapide, économique' },
      ],
    },
  ],
  IMAGE: [
    {
      id: 'gemini',
      label: 'Google Gemini (Nano Banana)',
      envKey: 'GOOGLE_GEMINI_API_KEY',
      models: [
        { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', costTier: '$$$', note: 'réalisme + typographie parfaite' },
        { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', costTier: '$$', note: 'génération + édition rapides' },
        { id: 'gemini-2.5-flash-image', label: 'Nano Banana', costTier: '$', note: 'économique, texte dans l’image fiable' },
      ],
    },
    {
      id: 'fal',
      label: 'fal.ai (FLUX, Nano Banana…)',
      envKey: 'FAL_KEY',
      models: [
        { id: 'fal-ai/flux/schnell', label: 'FLUX Schnell (fal)', costTier: '$', note: 'ultra-rapide' },
        { id: 'fal-ai/flux/dev', label: 'FLUX Dev (fal)', costTier: '$$', note: 'meilleure qualité' },
        { id: 'fal-ai/flux-pro/v1.1', label: 'FLUX 1.1 Pro (fal)', costTier: '$$$', note: 'qualité maximale' },
        { id: 'fal-ai/nano-banana-2', label: 'Nano Banana 2 (fal)', costTier: '$$', note: 'hébergé chez fal.ai' },
        { id: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro (fal)', costTier: '$$$', note: 'typographie soignée' },
      ],
    },
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
      id: 'fal',
      label: 'fal.ai (Kling, Seedance…)',
      envKey: 'FAL_KEY',
      models: [
        { id: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', label: 'Kling 2.5 Turbo Pro', costTier: '$$$', note: 'qualité cinématique' },
        { id: 'fal-ai/veo3/fast', label: 'Veo 3 Fast', costTier: '$$$', note: 'seul à générer l’audio (voix, musique)' },
        { id: 'fal-ai/seedance-2.5/text-to-video', label: 'Seedance 2.5', costTier: '$$', note: 'clips longs (jusqu’à ~30 s), 720p' },
        { id: 'bytedance/seedance-2.0/text-to-video', label: 'Seedance 2.0', costTier: '$$', note: 'texte → vidéo polyvalent' },
        { id: 'bytedance/seedance-2.0/fast/text-to-video', label: 'Seedance 2.0 Fast', costTier: '$', note: 'rapide et économique' },
      ],
    },
    {
      id: 'higgsfield',
      label: 'Higgsfield (Seedance, Kling, Hailuo, Sora…)',
      envKey: 'HIGGSFIELD_API_KEY_ID',
      models: [
        { id: 'bytedance/seedance/v1/pro/fast/text-to-video', label: 'Seedance 1.0 Pro Fast', costTier: '$$', note: '1080p, ratio 9:16 natif' },
        { id: 'bytedance/seedance/v1/lite/text-to-video', label: 'Seedance 1.0 Lite', costTier: '$', note: 'économique' },
        { id: 'kling-video/v2.5-turbo/pro/text-to-video', label: 'Kling 2.5 Turbo Pro', costTier: '$$$', note: 'qualité cinématique' },
        { id: 'minimax/hailuo-2.3/pro/text-to-video', label: 'Hailuo 2.3 Pro', costTier: '$$$', note: 'mouvements réalistes' },
        { id: 'sora-2/text-to-video', label: 'Sora 2', costTier: '$$$', note: '720p, 4-12 s' },
        { id: 'wan-25-preview/text-to-video', label: 'Wan 2.5', costTier: '$$', note: 'texte → vidéo polyvalent' },
      ],
    },
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
