/**
 * AIRouterService — central routing logic that picks the BEST provider per task.
 *
 * Strategy (each provider for what it does best):
 *
 *  ┌────────────────────┬──────────────────────────────────────────┐
 *  │ Claude (Anthropic) │ Reasoning, agentic tool use, structured  │
 *  │                    │ analysis, code, brand strategy, long-form│
 *  ├────────────────────┼──────────────────────────────────────────┤
 *  │ GPT (OpenAI)       │ Fast cheap text, strict JSON, DALL-E for │
 *  │                    │ images-with-text, ad copy variants       │
 *  ├────────────────────┼──────────────────────────────────────────┤
 *  │ Gemini             │ Vision (native), long context 1M+,       │
 *  │                    │ grounded search, daily intelligence      │
 *  ├────────────────────┼──────────────────────────────────────────┤
 *  │ Replicate FLUX     │ Cheap fast images, artistic/lifestyle    │
 *  │ Stability SDXL     │ Open weights, controllable               │
 *  └────────────────────┴──────────────────────────────────────────┘
 *
 * Each task type has:
 *   - primary provider (preferred)
 *   - fallback chain
 *   - automatic degradation to mock if nothing available
 */
import { logger } from '@/lib/logger';
import { AIProviderService } from './AIProviderService';
import { GeminiService } from './GeminiService';
import { mockAdapter } from './adapters/mock';
import { openaiAdapter } from './adapters/openai';
import { anthropicAdapter } from './adapters/anthropic';
import { geminiAdapter } from './adapters/gemini';
import { replicateImageAdapter } from './adapters/replicate-image';
import { stabilityImageAdapter } from './adapters/stability-image';
import { falAdapter } from './adapters/fal';
import { CanvaService } from '@/services/canva/CanvaService';

/**
 * Typed error so callers (ConcretizationService, UI) can distinguish "no
 * Canva template for this brand" from a real Canva API failure and skip
 * silently per product requirement.
 */
export class CanvaNoTemplateError extends Error {
  code = 'CANVA_NO_TEMPLATE';
  constructor(brandId?: string | null) {
    super(brandId ? `No CanvaTemplate found for brand ${brandId}` : 'No CanvaTemplate found');
    this.name = 'CanvaNoTemplateError';
  }
}
import type {
  TextGenerationInput, TextGenerationOutput, ImageGenerationInput, ImageGenerationOutput,
} from './types';

export type TaskType =
  // Text tasks
  | 'TEXT_SHORT_COPY'       // IG caption, tweet — fast cheap
  | 'TEXT_LONGFORM'         // LinkedIn article, blog — quality
  | 'TEXT_STRATEGIC'        // brand strategy, SWOT, competitor — best reasoning
  | 'TEXT_STRUCTURED_JSON'  // ad copy variants, structured output — JSON reliable
  | 'TEXT_AD_VARIANTS'      // many fast variants — cheap
  | 'TEXT_REEL_SCRIPT'      // video script narrative — quality
  | 'TEXT_EMAIL'            // email marketing — quality
  // Image tasks
  | 'IMAGE_PHOTOREALISTIC'  // product shots, lifestyle — FLUX/DALL-E
  | 'IMAGE_ARTISTIC'        // illustrations, abstract — FLUX dev
  | 'IMAGE_AD_WITH_TEXT'    // banner with text overlay — DALL-E (best text rendering)
  | 'IMAGE_REEL_THUMBNAIL'  // YouTube/Reel thumbnails — DALL-E/FLUX
  // Vision tasks
  | 'VISION_DESCRIBE'       // describe image — Gemini cheap
  | 'VISION_BRAND_AUDIT'    // brand compliance — Gemini structured
  | 'VISION_OCR'            // extract text from image — Gemini
  // Research
  | 'RESEARCH_GROUNDED'     // real-time facts with citations — Gemini only
  // Multi-doc
  | 'LONG_CONTEXT_ANALYSIS' // analyze N docs at once — Gemini Pro 1M+ ctx
  // Agent
  | 'AGENT_TOOL_USE';       // multi-step with tools — Claude best

export interface ProviderCapability {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
}

export interface RoutingPlan {
  task: TaskType;
  primary: { provider: string; model?: string };
  fallbacks: Array<{ provider: string; model?: string }>;
  reasonChosen: string;
  available: boolean;
}

// ============================================================================
// PROVIDER AVAILABILITY (cached per request)
// ============================================================================
function isAvailable(provider: string): boolean {
  switch (provider) {
    case 'claude': return !!process.env.ANTHROPIC_API_KEY;
    case 'gpt': return !!process.env.OPENAI_API_KEY;
    case 'gemini': return !!process.env.GOOGLE_GEMINI_API_KEY;
    case 'replicate': return !!process.env.REPLICATE_API_TOKEN;
    case 'fal': return !!process.env.FAL_KEY;
    case 'stability': return !!process.env.STABILITY_API_KEY;
    case 'dalle': return !!process.env.OPENAI_API_KEY; // DALL-E via OpenAI
    // Canva is "available" at the routing layer as soon as the env keys are
    // configured. Whether an actual brand has a CanvaTemplate linked is
    // checked at call time (see generateImageForTask below).
    case 'canva': return !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET;
    case 'mock': return true;
    default: return false;
  }
}

// ============================================================================
// STRATEGY TABLE — each task -> ordered preference of providers
// ============================================================================
const STRATEGY: Record<TaskType, { providers: string[]; reason: string }> = {
  // === TEXT ===
  TEXT_SHORT_COPY: {
    providers: ['gpt', 'gemini', 'claude', 'mock'],
    reason: 'GPT-4o-mini = fast + cheap pour captions. Gemini Flash en fallback (idem perf, prix similaire).',
  },
  TEXT_LONGFORM: {
    providers: ['claude', 'gpt', 'gemini', 'mock'],
    reason: 'Claude excelle en long-form structuré. GPT en fallback.',
  },
  TEXT_STRATEGIC: {
    providers: ['claude', 'gpt', 'mock'],
    reason: 'Claude domine en raisonnement stratégique multi-étape (SWOT, brand strategy).',
  },
  TEXT_STRUCTURED_JSON: {
    providers: ['gpt', 'claude', 'gemini', 'mock'],
    reason: 'GPT-4o-mini = meilleur respect du JSON strict. Tous trois fiables.',
  },
  TEXT_AD_VARIANTS: {
    providers: ['gpt', 'gemini', 'claude', 'mock'],
    reason: 'Variantes en masse = priorité au pas cher rapide. GPT-mini + Gemini Flash imbattables.',
  },
  TEXT_REEL_SCRIPT: {
    providers: ['claude', 'gpt', 'gemini', 'mock'],
    reason: 'Scripts vidéo narratifs = Claude (structure dramatique). GPT solide en backup.',
  },
  TEXT_EMAIL: {
    providers: ['claude', 'gpt', 'mock'],
    reason: 'Emails marketing = ton + structure. Claude pour qualité, GPT pour variantes A/B.',
  },

  // === IMAGE ===
  // ⚠️ Ordre des fournisseurs d'images : fal.ai renvoie une URL DÉJÀ hébergée,
  // les autres renvoient du base64 qui doit transiter par Supabase Storage. Si
  // le stockage refuse l'écriture (RLS / clé service_role invalide), toute
  // génération base64 est perdue APRÈS avoir été payée. fal.ai passe donc en
  // tête : c'est le chemin qui ne dépend d'aucune configuration externe.
  // Un modèle précis reste imposable depuis Paramètres → Modèles IA.
  IMAGE_PHOTOREALISTIC: {
    providers: ['fal', 'replicate', 'gemini', 'dalle', 'stability', 'mock'],
    reason: 'FLUX schnell via fal.ai = rapide, pas cher, URL hébergée (aucune dépendance au stockage). Replicate puis Nano Banana/DALL-E en secours.',
  },
  IMAGE_ARTISTIC: {
    providers: ['fal', 'replicate', 'stability', 'gemini', 'dalle', 'mock'],
    reason: 'FLUX dev / SDXL plus polyvalents en styles artistiques que DALL-E ; fal.ai en tête pour l’URL hébergée.',
  },
  IMAGE_AD_WITH_TEXT: {
    providers: ['fal', 'gemini', 'dalle', 'replicate', 'stability', 'mock'],
    reason: 'Nano Banana (Gemini) rend le mieux le texte, mais renvoie du base64 : fal.ai passe devant tant que le stockage n’est pas fiable.',
  },
  IMAGE_REEL_THUMBNAIL: {
    providers: ['fal', 'gemini', 'dalle', 'replicate', 'stability', 'mock'],
    reason: 'Thumbnails 16:9 : fal.ai en tête (URL hébergée), Nano Banana / DALL-E ensuite pour la typographie.',
  },

  // === VISION ===
  VISION_DESCRIBE: {
    providers: ['gemini', 'gpt', 'mock'],
    reason: 'Gemini Flash multimodal natif, cheap + rapide. GPT-4o aussi capable.',
  },
  VISION_BRAND_AUDIT: {
    providers: ['gemini', 'gpt', 'mock'],
    reason: 'Gemini Pro structured-output JSON = audit visuel fiable.',
  },
  VISION_OCR: {
    providers: ['gemini', 'gpt', 'mock'],
    reason: 'Gemini = très bon OCR multilingue gratuit en Flash.',
  },

  // === RESEARCH ===
  RESEARCH_GROUNDED: {
    providers: ['gemini', 'mock'],
    reason: 'Seul Gemini a la Google Search grounding native avec citations.',
  },

  // === LONG CONTEXT ===
  LONG_CONTEXT_ANALYSIS: {
    providers: ['gemini', 'claude', 'mock'],
    reason: 'Gemini 2.5 Pro = 1M tokens. Claude Sonnet = 200k. Pour >200k = Gemini obligatoire.',
  },

  // === AGENT ===
  AGENT_TOOL_USE: {
    providers: ['claude', 'gpt', 'mock'],
    reason: 'Claude domine en chaînes d\'outils complexes (>5 tools). GPT en fallback simple.',
  },
};

// --- Routage "intelligent" (mode AUTO) --------------------------------------
// Réordonne une chaîne de fournisseurs selon la fiabilité OBSERVÉE (AIRequest,
// 7 jours, cache 5 min). Un fournisseur qui échoue nettement plus recule dans
// la chaîne — sans jamais en sortir : le routage statique reste le filet.
const RELIABILITY_KEYS: Record<string, string[]> = {
  claude: ['anthropic', 'claude'],
  gpt: ['openai', 'gpt'],
  gemini: ['gemini', 'gemini-grounded'],
  replicate: ['replicate'],
  fal: ['fal'],
  stability: ['stability'],
  dalle: ['dalle', 'openai-image'],
};
let reliabilityCache: { at: number; scores: Map<string, number> } | null = null;

async function smartOrder<T extends { provider: string }>(chain: T[]): Promise<T[]> {
  try {
    const now = Date.now();
    if (!reliabilityCache || now - reliabilityCache.at > 5 * 60_000) {
      const { AIReliabilityService } = await import('./AIReliabilityService');
      const metrics = await AIReliabilityService.getMetrics(null, 7);
      const scores = new Map<string, number>();
      for (const [pid, keys] of Object.entries(RELIABILITY_KEYS)) {
        const list = metrics.filter((m) => keys.includes(m.provider));
        const reqs = list.reduce((s, m) => s + m.requests, 0);
        if (reqs >= 5) {
          scores.set(pid, list.reduce((s, m) => s + m.successRate * m.requests, 0) / reqs);
        }
      }
      reliabilityCache = { at: now, scores };
    }
    const scores = reliabilityCache.scores;
    return [...chain].sort((a, b) => {
      const sa = scores.get(a.provider);
      const sb = scores.get(b.provider);
      if (sa == null || sb == null) return 0;
      // Écart significatif seulement (>10 pts) — sinon on respecte l'ordre métier.
      if (Math.abs(sa - sb) < 0.1) return 0;
      return sb - sa;
    });
  } catch {
    return chain;
  }
}

export const AIRouterService = {
  /**
   * Returns the routing plan for a task — which provider would be chosen and why.
   * Useful for the reliability report and admin UI.
   */
  planFor(task: TaskType): RoutingPlan {
    const strat = STRATEGY[task];
    const ordered = strat.providers.filter((p) => isAvailable(p));
    return {
      task,
      primary: ordered[0] ? { provider: ordered[0] } : { provider: 'unavailable' },
      fallbacks: ordered.slice(1).map((p) => ({ provider: p })),
      reasonChosen: strat.reason,
      available: ordered.length > 0,
    };
  },

  /**
   * Returns ALL routing plans for the diagnostic panel.
   */
  allPlans(): RoutingPlan[] {
    return (Object.keys(STRATEGY) as TaskType[]).map((t) => this.planFor(t));
  },

  /**
   * Provider availability snapshot.
   */
  availability(): ProviderCapability[] {
    return [
      { id: 'claude', label: 'Anthropic Claude', available: isAvailable('claude') },
      { id: 'gpt', label: 'OpenAI GPT', available: isAvailable('gpt') },
      { id: 'gemini', label: 'Google Gemini', available: isAvailable('gemini') },
      { id: 'replicate', label: 'Replicate (FLUX)', available: isAvailable('replicate') },
      { id: 'fal', label: 'fal.ai (FLUX, Kling…)', available: isAvailable('fal') },
      { id: 'stability', label: 'Stability AI', available: isAvailable('stability') },
      { id: 'dalle', label: 'OpenAI DALL-E', available: isAvailable('dalle') },
      { id: 'canva', label: 'Canva', available: isAvailable('canva') },
    ];
  },

  /**
   * Generate text for a specific task — router picks the best available provider.
   */
  async generateTextForTask(task: TaskType, input: TextGenerationInput): Promise<TextGenerationOutput> {
    const plan = this.planFor(task);
    let chain = [plan.primary, ...plan.fallbacks];
    // Préférence org FORCED: le fournisseur imposé passe en tête (les autres
    // restent en fallback — une panne du forcé ne bloque pas la production).
    if (input.forceProvider) {
      chain = [
        { provider: input.forceProvider },
        ...chain.filter((c) => c.provider !== input.forceProvider),
      ];
    } else {
      // Mode AUTO "intelligent": réordonne selon la fiabilité observée (7 j).
      chain = await smartOrder(chain);
    }
    let lastError: Error | undefined;
    for (const p of chain) {
      try {
        let adapter;
        switch (p.provider) {
          case 'claude': adapter = anthropicAdapter; break;
          case 'gpt': adapter = openaiAdapter; break;
          case 'gemini': adapter = geminiAdapter; break;
          default: continue;
        }
        const result = await adapter.generateText(input);
        logger.info('AIRouter routed', { task, provider: p.provider });
        return result;
      } catch (err) {
        lastError = err as Error;
        logger.warn('AIRouter fallback', { task, provider: p.provider, err: lastError.message });
      }
    }
    // All real providers failed -> mock
    return mockAdapter.generateText(input);
  },

  /**
   * Generate image for a specific task — router picks the best available provider.
   */
  async generateImageForTask(task: TaskType, input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const plan = this.planFor(task);
    let chain = [plan.primary, ...plan.fallbacks];
    if (input.forceProvider) {
      chain = [
        { provider: input.forceProvider },
        ...chain.filter((c) => c.provider !== input.forceProvider),
      ];
    } else {
      chain = await smartOrder(chain);
    }
    let lastError: Error | undefined;
    for (const p of chain) {
      try {
        if (p.provider === 'canva') {
          // Canva path: requires brandId + an existing CanvaTemplate for that brand.
          // Throws CanvaNoTemplateError so callers can skip silently.
          return await this.generateImageViaCanva(input);
        }
        if (p.provider === 'replicate') return await replicateImageAdapter.generateImage(input);
        if (p.provider === 'fal') return await falAdapter.generateImage(input);
        if (p.provider === 'gemini') {
          // Nano Banana — input.model n'est honoré que s'il s'agit d'un id
          // Google (gemini-*/imagen-*), jamais un id Replicate/fal en fallback.
          const geminiModel =
            input.model && /^(gemini-|imagen-)/.test(input.model) ? input.model : undefined;
          const g = await GeminiService.generateImage({
            prompt: input.prompt,
            aspectRatio: input.aspectRatio as '1:1' | '4:5' | '9:16' | '16:9' | undefined,
            styleHint: input.styleHint,
            model: geminiModel,
          });
          if (g.mocked) throw new Error('Gemini image indisponible (clé absente)');
          return { url: g.url, provider: 'gemini' as never, mocked: false };
        }
        if (p.provider === 'stability') return await stabilityImageAdapter.generateImage(input);
        if (p.provider === 'dalle' && process.env.OPENAI_API_KEY) {
          // DALL-E via OpenAI
          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              // input.model n'est honoré que s'il s'agit d'un modèle OpenAI —
              // en fallback il peut contenir un id Replicate (flux…).
              model: ['gpt-image-1', 'dall-e-3', 'dall-e-2'].includes(input.model ?? '')
                ? input.model
                : 'gpt-image-1',
              prompt: input.styleHint ? `${input.prompt}, ${input.styleHint}` : input.prompt,
              size: input.aspectRatio === '16:9' ? '1792x1024'
                : input.aspectRatio === '9:16' ? '1024x1792'
                : input.aspectRatio === '4:5' ? '1024x1024'
                : '1024x1024',
              n: 1,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
            const item = data.data?.[0];
            if (item?.url) return { url: item.url, provider: 'openai' as never, mocked: false };
            if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}`, provider: 'openai' as never, mocked: false };
          }
          throw new Error(`DALL-E ${res.status}`);
        }
      } catch (err) {
        lastError = err as Error;
        logger.warn('AIRouter image fallback', { task, provider: p.provider, err: lastError.message });
      }
    }
    return mockAdapter.generateImage!(input);
  },

  /**
   * Generate a "visual" via Canva by instantiating a brand template.
   * Throws CanvaNoTemplateError when no template is linked to the brand so
   * callers (ConcretizationService) can skip silently per product requirement.
   */
  async generateImageViaCanva(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    if (!input.brandId) {
      throw new CanvaNoTemplateError(null);
    }
    const template = await CanvaService.findTemplateForBrand(input.brandId);
    if (!template) {
      throw new CanvaNoTemplateError(input.brandId);
    }
    let orgId = input.organizationId;
    if (!orgId) {
      // Best-effort: resolve org from brand. We avoid a full Brand fetch here to
      // keep the router lean; CanvaService will still persist correctly using
      // template.brandId. If no orgId is available we fail soft to mock.
      const { db } = await import('@/lib/db');
      const brand = await db.brand.findUnique({ where: { id: input.brandId }, select: { organizationId: true } });
      orgId = brand?.organizationId;
    }
    if (!orgId) {
      throw new CanvaNoTemplateError(input.brandId);
    }
    const variables = {
      title: input.canvaVariables?.title,
      body: input.canvaVariables?.body,
      hashtags: input.canvaVariables?.hashtags,
      image: input.canvaVariables?.image,
      ...input.canvaVariables,
    };
    const design = await CanvaService.createDesignFromBrandTemplate({
      templateId: template.id,
      organizationId: orgId,
      brandId: input.brandId,
      variables,
    });
    return {
      url: design.thumbnailUrl || design.editUrl,
      provider: 'canva',
      mocked: design.mocked,
      canvaMode: design.mode,
      canvaDesignId: design.id,
      editUrl: design.editUrl,
    };
  },

  /**
   * Convenience: vision (always routes through Gemini if available).
   */
  async visionAnalyze(opts: { imageUrl: string; prompt: string }) {
    if (GeminiService.isConfigured()) {
      return GeminiService.analyzeImage({ imageUrl: opts.imageUrl, prompt: opts.prompt });
    }
    // Fallback: GPT-4o vision
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: opts.prompt },
                { type: 'image_url', image_url: { url: opts.imageUrl } },
              ],
            },
          ],
          max_tokens: 1024,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices: { message: { content: string } }[] };
        return { text: data.choices?.[0]?.message?.content ?? '', parsed: undefined };
      }
    }
    return { text: '[MOCK] Aucun provider vision disponible.', parsed: undefined };
  },
};

// Re-export for convenience
export { AIProviderService };
