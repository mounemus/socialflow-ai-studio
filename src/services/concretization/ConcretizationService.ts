/**
 * ConcretizationService — the new core of acte 4 of the unified journey.
 *
 * Takes a StrategyItem (already APPROVED/EXECUTED) and produces ready-to-publish
 * content with a real preview: caption + hashtags + CTA + visual(s) + (when
 * relevant) a video script or an email subject/body.
 *
 * Responsibilities:
 *   1. Load the strategy item + strategy + brand + profile + DNA
 *   2. Dispatch to the per-kind promptBuilder (promptBuilders.ts)
 *   3. Drive AIRouterService through caption → image → video → email steps
 *   4. Persist the production output on item.metadata.concretization
 *   5. Persist images as MediaAsset rows linked to the Post (creating one if needed)
 *   6. Expose listing / regeneration / mark-ready helpers
 *
 * All providers degrade to mocks if no API keys — same pattern as the rest of the codebase.
 */
import type {
  Brand,
  BrandProfile,
  MarketingStrategy,
  Post,
  StrategyItem,
  SupportFormat,
} from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { invalidate } from '@/lib/cache';
import { AIRouterService, CanvaNoTemplateError } from '@/services/ai/AIRouterService';
import { CanvaService } from '@/services/canva/CanvaService';
import { BrandDNAService, type BrandDNA } from '@/services/intelligence/BrandDNAService';
import { learnedStrategyBlock } from '@/services/watch/learning';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';
import { isPlaceholderVisualUrl } from '@/lib/post-media';
import { estimateAiCostCents } from '@/lib/ai-cost';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';
import { falAdapter } from '@/services/ai/adapters/fal';
import {
  AIModelPreferenceService,
  type OrgModelPreferences,
} from '@/services/ai/AIModelPreferenceService';
import {
  buildPromptsForItem,
  isCarouselItem,
  type BuilderOutput,
  type ConcretizationAspect,
  type RecommendedProvider,
} from './promptBuilders';

// =================================================================
// TYPES
// =================================================================

export type ConcretizationStatus = 'pending' | 'producing' | 'ready' | 'failed';

export interface ConcretizationVariant {
  url: string;
  prompt: string;
  provider: string;
  mocked: boolean;
  /**
   * Renseigné quand la variante n'a PAS produit d'image exploitable
   * (échec du générateur, upload de stockage refusé). Permet à l'UI de dire
   * la vérité au lieu d'afficher un succès pour un visuel absent.
   */
  issue?: string;
  /** When the variant came from Canva — persisted CanvaDesign id. */
  canvaDesignId?: string;
  /** When the variant came from Canva — direct edit URL. */
  editUrl?: string;
}

export interface ConcretizationEmailFields {
  subject: string;
  preheader?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string | null;
  subjectCandidates?: string[];
}

export interface ConcretizationVideoScript {
  hook: string;
  scenes: Array<{ time: string; visual: string; voiceover: string }>;
  cta?: string;
  raw?: string;
}

export interface ConcretizationPayload {
  imageUrls: string[];
  variants: ConcretizationVariant[];
  caption: string;
  hashtags: string[];
  cta: string;
  videoScript?: ConcretizationVideoScript;
  emailSubject?: string;
  emailBody?: string;
  emailFields?: ConcretizationEmailFields;
  provider: string;
  mocked: boolean;
  status: ConcretizationStatus;
  generatedAt: string;
  readyAt?: string;
  aspectRatio: ConcretizationAspect;
  /**
   * Prompt image effectivement utilisé (après directeur artistique IA).
   * Éditable par l'utilisateur à l'Acte 4 — « Régénérer visuel » le respecte.
   */
  imagePrompt?: string;
  /** extra structured fields produced by per-kind builders (slides, variants, tagline...) */
  extras?: Record<string, unknown>;
}

export interface ConcretizationResult {
  itemId: string;
  postId: string | null;
  variants: ConcretizationVariant[];
  caption: string;
  hashtags: string[];
  cta: string;
  videoScript?: ConcretizationVideoScript;
  emailFields?: ConcretizationEmailFields;
  provider: string;
  mocked: boolean;
  status: ConcretizationStatus;
  aspectRatio: ConcretizationAspect;
  extras?: Record<string, unknown>;
  /**
   * Vérité opérationnelle : `false` quand aucun visuel exploitable n'a été
   * produit (génération en échec, upload de stockage refusé, prompt image
   * absent). L'appelant DOIT s'en servir — un HTTP 200 ne signifie pas
   * qu'une image existe.
   */
  visualProduced: boolean;
  /** Raison lisible quand `visualProduced` est faux. */
  visualIssue?: string;
}

// =================================================================
// HELPERS
// =================================================================

/**
 * Generator backends only accept 1:1 | 4:5 | 9:16 | 16:9. Map 1.91:1 → 16:9.
 */
function toGeneratorAspect(a: ConcretizationAspect): '1:1' | '4:5' | '9:16' | '16:9' {
  if (a === '1.91:1') return '16:9';
  return a;
}

/**
 * Map the StrategyItem.format (string) to the closest SupportFormat enum value
 * so the linked Post is well-typed. Falls back to INSTAGRAM_POST.
 */
function toSupportFormat(item: StrategyItem): SupportFormat {
  const raw = String(item.format ?? '').toUpperCase().replace(/[\s-]/g, '_');
  const allowed: SupportFormat[] = [
    'INSTAGRAM_POST', 'INSTAGRAM_STORY', 'INSTAGRAM_REEL', 'INSTAGRAM_CAROUSEL',
    'FACEBOOK_POST', 'FACEBOOK_STORY',
    'LINKEDIN_POST', 'LINKEDIN_ARTICLE',
    'TWITTER_POST', 'TWITTER_THREAD',
    'TIKTOK_VIDEO', 'YOUTUBE_SHORT', 'YOUTUBE_THUMBNAIL', 'PINTEREST_PIN',
    'WEB_BANNER', 'AD_VISUAL', 'FLYER', 'POSTER', 'PRESENTATION',
    'EDUCATIONAL_CAROUSEL', 'PRODUCT_SHEET', 'NEWSLETTER', 'EMAIL_MARKETING',
    'LANDING_COPY', 'VIDEO_SCRIPT', 'STORYBOARD', 'VOICEOVER',
    'EDITORIAL_CALENDAR', 'CREATIVE_BRIEF', 'CAMPAIGN_GUIDE', 'MEDIA_KIT', 'PRESS_KIT',
  ];
  if (allowed.includes(raw as SupportFormat)) return raw as SupportFormat;

  // Heuristics from item.kind
  switch (item.kind) {
    case 'REEL_IDEA':     return 'INSTAGRAM_REEL';
    case 'EMAIL_IDEA':    return 'EMAIL_MARKETING';
    case 'AD_IDEA':       return 'AD_VISUAL';
    case 'CAMPAIGN_IDEA': return 'CAMPAIGN_GUIDE';
    default:              return 'INSTAGRAM_POST';
  }
}

function extractJSON<T = unknown>(text: string): T | null {
  // Greedy match — handles json blocks wrapped in ```json fences
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

interface LoadedContext {
  item: StrategyItem;
  strategy: MarketingStrategy;
  brand: (Brand & { profile: BrandProfile | null }) | null;
  dna: BrandDNA | null;
}

async function loadItemContext(itemId: string): Promise<LoadedContext> {
  const itemRaw = await db.strategyItem.findUnique({
    where: { id: itemId },
    include: { strategy: true },
  });
  if (!itemRaw) throw new Error(`StrategyItem ${itemId} not found`);

  // Some test mocks return the item without resolving the `strategy` include.
  // Fall back to a separate lookup to remain resilient.
  const item = itemRaw as StrategyItem & { strategy?: MarketingStrategy };
  let strategy: MarketingStrategy | null = item.strategy ?? null;
  if (!strategy && item.strategyId) {
    strategy = await db.marketingStrategy.findUnique({ where: { id: item.strategyId } });
  }
  if (!strategy) throw new Error(`MarketingStrategy for item ${itemId} not found`);

  const brand = await db.brand.findUnique({
    where: { id: strategy.brandId },
    include: { profile: true },
  });

  let dna: BrandDNA | null = null;
  try {
    dna = await BrandDNAService.getStoredFor(strategy.brandId);
  } catch (err) {
    logger.warn('ConcretizationService.loadItemContext: DNA fetch failed', {
      brandId: strategy.brandId,
      err: (err as Error).message,
    });
  }

  return { item, strategy, brand, dna };
}

/**
 * Find or create the Post linked to a StrategyItem. The Post is the durable
 * surface for the media assets and downstream scheduling.
 */
async function ensurePostForItem(item: StrategyItem, organizationId: string, brandId: string | null): Promise<Post | null> {
  // Test/legacy environments may not expose db.post — bail out gracefully.
  // Callers must tolerate a null return.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(db as any).post) return null;

  if (item.postId) {
    const existing = await db.post.findUnique({ where: { id: item.postId } });
    if (existing) return existing;
  }

  const post = await db.post.create({
    data: {
      organizationId,
      brandId: brandId ?? undefined,
      status: 'AI_GENERATED',
      format: toSupportFormat(item),
      title: item.title,
      body: item.description,
      hashtags: item.hashtags ?? [],
      cta: item.cta ?? null,
      // `platform` conservée ici : les formats transverses (AD_VISUAL,
      // EMAIL_MARKETING…) ne l'encodent pas, et sans elle la publication ne
      // savait pas quel compte social viser.
      metadata: { originStrategyItemId: item.id, platform: item.platform ?? null } as never,
    },
  });

  await db.strategyItem.update({
    where: { id: item.id },
    data: { postId: post.id },
  });

  return post;
}

/**
 * Generate one image — uses the provider hint from the builder (or a forced one).
 * Always returns at least a mocked variant.
 */
async function generateOneImage(
  prompt: string,
  aspect: ConcretizationAspect,
  preferredProvider: RecommendedProvider | string,
  organizationId?: string,
  modelPrefs?: OrgModelPreferences,
  /**
   * `true` uniquement quand l'UTILISATEUR a explicitement choisi le
   * fournisseur. Une simple recommandation du builder ne doit PAS écraser
   * l'ordre du routeur : sinon un provider base64 repasse en tête et la
   * génération est perdue à l'upload alors qu'un provider à URL hébergée
   * était disponible.
   */
  hardForce = false,
): Promise<ConcretizationVariant> {
  const generatorAspect = toGeneratorAspect(aspect);

  // Map the provider hint → a TaskType. The router still falls back internally.
  const taskByProvider: Record<string, Parameters<typeof AIRouterService.generateImageForTask>[0]> = {
    dalle:  'IMAGE_AD_WITH_TEXT',
    'gpt-image': 'IMAGE_AD_WITH_TEXT',
    flux:   'IMAGE_PHOTOREALISTIC',
    fal:    'IMAGE_PHOTOREALISTIC',
    gemini: 'IMAGE_PHOTOREALISTIC',
    claude: 'IMAGE_PHOTOREALISTIC',
  };
  const task = taskByProvider[preferredProvider] ?? 'IMAGE_PHOTOREALISTIC';

  // Le choix de l'utilisateur doit VRAIMENT forcer le fournisseur. Auparavant
  // `preferredProvider` ne servait qu'à choisir un TaskType (identique pour
  // flux/gemini/claude) : sélectionner « Gemini » n'avait aucun effet réel.
  const ROUTER_PROVIDER: Record<string, string> = {
    dalle: 'dalle',
    'gpt-image': 'dalle', // même API OpenAI, modèle différent (voir OPENAI_IMAGE_MODEL)
    flux: 'replicate',
    fal: 'fal',
    gemini: 'gemini',
  };
  const forced = hardForce ? ROUTER_PROVIDER[preferredProvider] : undefined;

  try {
    const imageInput: {
      prompt: string;
      aspectRatio: typeof generatorAspect;
      forceProvider?: string;
      model?: string;
    } = { prompt, aspectRatio: generatorAspect };
    if (modelPrefs) AIModelPreferenceService.applyImage(imageInput as never, modelPrefs);
    if (forced) {
      // Un choix explicite par item prime sur la préférence d'organisation.
      if (imageInput.forceProvider && imageInput.forceProvider !== forced) {
        delete imageInput.model; // le modèle forcé appartenait à un autre fournisseur
      }
      imageInput.forceProvider = forced;
      // Les deux options OpenAI partagent le provider 'dalle' — le modèle fait la différence.
      const OPENAI_IMAGE_MODEL: Record<string, string> = { 'gpt-image': 'gpt-image-1', dalle: 'dall-e-3' };
      if (forced === 'dalle') imageInput.model = OPENAI_IMAGE_MODEL[String(preferredProvider)] ?? 'gpt-image-1';
    }
    const out = await AIRouterService.generateImageForTask(task, imageInput);
    let url = out.url;
    // Les images en base64 (DALL-E) ne doivent JAMAIS finir en base : upload
    // vers Supabase Storage → URL publique légère.
    if (url.startsWith('data:') && organizationId) {
      const uploaded = await SupabaseStorageService.uploadDataUrl({
        organizationId,
        dataUrl: url,
        prefix: 'concretization',
      });
      if (uploaded) {
        url = uploaded;
      } else {
        logger.warn('generateOneImage: upload du base64 impossible', {
          provider: String(out.provider),
        });
        // Le fournisseur a bien produit l'image, mais le stockage l'a refusée
        // (RLS du bucket / clé service_role). Plutôt que d'abandonner, on
        // retente avec un fournisseur qui renvoie une URL DÉJÀ hébergée et ne
        // dépend donc pas du tout de Supabase Storage.
        const hosted = await generateViaHostedProvider(prompt, generatorAspect, forced);
        if (hosted) {
          logger.info('generateOneImage: repli sur un fournisseur hébergé après échec du stockage', {
            failedProvider: String(out.provider),
            fallbackProvider: hosted.provider,
          });
          return hosted;
        }
        // Honnête : visuel absent + régénérable, plutôt qu'un payload empoisonné
        // par plusieurs Mo de base64. La raison remonte jusqu'à l'UI.
        return {
          url: '',
          prompt,
          provider: String(out.provider ?? preferredProvider),
          mocked: out.mocked,
          issue:
            "image générée, mais Supabase Storage a refusé de l'enregistrer " +
            '(politique RLS du bucket ou clé service_role invalide), et aucun ' +
            'fournisseur à URL hébergée (fal.ai) n’était disponible pour prendre le relais.',
        };
      }
    }
    if (!url) {
      return {
        url: '',
        prompt,
        provider: String(out.provider ?? preferredProvider),
        mocked: out.mocked,
        issue: 'le fournisseur n’a renvoyé aucune image',
      };
    }
    return {
      url,
      prompt,
      provider: String(out.provider ?? preferredProvider),
      mocked: out.mocked,
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.warn('ConcretizationService.generateOneImage failed', {
      err: message,
      preferredProvider,
    });
    return {
      url: `https://placehold.co/1024x1024/png?text=${encodeURIComponent(prompt.slice(0, 40))}`,
      prompt,
      provider: 'mock',
      mocked: true,
      issue: `génération impossible (${preferredProvider}) : ${message.slice(0, 160)}`,
    };
  }
}

/**
 * Repli sur un fournisseur qui renvoie une URL DÉJÀ hébergée (fal.ai), donc
 * sans passer par Supabase Storage. Utilisé quand un fournisseur base64
 * (Gemini, DALL-E) a bien généré l'image mais que le stockage l'a refusée :
 * sans ce repli, une seule mauvaise politique RLS supprime tous les visuels.
 * Retourne null si fal.ai n'est pas configuré ou échoue à son tour.
 */
async function generateViaHostedProvider(
  prompt: string,
  aspectRatio: ReturnType<typeof toGeneratorAspect>,
  alreadyTried?: string,
): Promise<ConcretizationVariant | null> {
  if (alreadyTried === 'fal') return null;
  if (!falAdapter.isConfigured()) return null;
  try {
    const out = await falAdapter.generateImage({ prompt, aspectRatio });
    if (!out.url || out.url.startsWith('data:')) return null;
    return { url: out.url, prompt, provider: 'fal', mocked: false };
  } catch (err) {
    logger.warn('generateViaHostedProvider: fal.ai a échoué', {
      err: (err as Error).message.slice(0, 200),
    });
    return null;
  }
}

/**
 * Vérité opérationnelle sur le visuel : un HTTP 200 ne veut pas dire qu'une
 * image existe. On considère qu'un visuel a été produit uniquement s'il reste
 * au moins une variante avec une URL réelle (ni vide, ni placeholder).
 */
function visualOutcome(
  variants: ConcretizationVariant[],
  imagePrompt?: string | null,
): { visualProduced: boolean; visualIssue?: string } {
  if (!imagePrompt) {
    return { visualProduced: false, visualIssue: 'aucun visuel prévu pour ce format' };
  }
  const usable = variants.filter(
    (v) => v.url && !isPlaceholderVisualUrl(v.url) && !v.url.startsWith('data:'),
  );
  if (usable.length > 0) return { visualProduced: true };
  const issue = variants.find((v) => v.issue)?.issue;
  return {
    visualProduced: false,
    visualIssue: issue ?? 'aucune image exploitable produite',
  };
}

/**
 * Try producing a Canva variant for a brand. Returns null when no template
 * is linked (silent skip per product requirement) or when Canva fails.
 */
async function tryCanvaVariant(args: {
  brandId: string | null;
  organizationId: string;
  prompt: string;
  caption: string;
  hashtags: string[];
  aspect: ConcretizationAspect;
}): Promise<ConcretizationVariant | null> {
  if (!args.brandId) return null;
  try {
    const hasTemplate = await CanvaService.hasTemplateForBrand(args.brandId);
    if (!hasTemplate) return null;
    const out = await AIRouterService.generateImageViaCanva({
      prompt: args.prompt,
      aspectRatio: toGeneratorAspect(args.aspect),
      brandId: args.brandId,
      organizationId: args.organizationId,
      canvaVariables: {
        title: args.prompt.slice(0, 80),
        body: args.caption.slice(0, 400),
        hashtags: args.hashtags,
      },
    });
    return {
      url: out.url,
      prompt: args.prompt,
      provider: 'canva',
      mocked: out.mocked,
      canvaDesignId: out.canvaDesignId,
      editUrl: out.editUrl,
    };
  } catch (err) {
    if (err instanceof CanvaNoTemplateError) {
      // Silent skip per spec: "Auto-skip Canva si pas de template"
      return null;
    }
    logger.warn('ConcretizationService.tryCanvaVariant failed', {
      err: (err as Error).message,
      brandId: args.brandId,
    });
    return null;
  }
}

/**
 * Journal de dépense IA (best-effort) — la concrétisation était le plus gros
 * consommateur du produit et n'écrivait AUCUN AIRequest : coût invisible pour
 * le garde-fou budgétaire, fournisseurs absents des métriques de routage.
 */
async function logAiSpend(
  organizationId: string,
  entries: Array<{ type: 'TEXT' | 'IMAGE'; provider: string; mocked: boolean }>,
  promptHint: string,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(db as any).aIRequest || entries.length === 0) return;
    const costCents = entries.reduce(
      (s, e) => s + (e.mocked ? 0 : estimateAiCostCents(e.type, e.provider)),
      0,
    );
    await db.aIRequest.create({
      data: {
        organizationId,
        type: (entries.some((e) => e.type === 'IMAGE') ? 'IMAGE' : 'TEXT') as never,
        prompt: promptHint.slice(0, 500),
        success: true,
        costCents,
        metadata: {
          via: 'concretization',
          provider: entries.find((e) => e.type === 'IMAGE')?.provider ?? entries[0]?.provider ?? null,
          calls: entries.length,
        } as never,
      },
    });
  } catch {
    // journal best-effort — jamais bloquant
  }
}

/**
 * Persist image variants as MediaAsset rows linked to the post.
 */
async function persistVariantsToPost(post: Post, variants: ConcretizationVariant[]): Promise<string[]> {
  const ids: string[] = [];
  for (const v of variants) {
    // Jamais de variante inutilisable en MediaAsset : une URL vide ou un
    // placeholder d'échec devenait « le média le plus récent » du post et
    // partait à la publication (ou la bloquait) à la place du vrai visuel.
    if (!v.url || isPlaceholderVisualUrl(v.url)) continue;
    const asset = await db.mediaAsset.create({
      data: {
        organizationId: post.organizationId,
        brandId: post.brandId ?? null,
        kind: 'IMAGE',
        url: v.url,
        source: 'ai',
        externalRef: v.provider,
        metadata: {
          prompt: v.prompt,
          provider: v.provider,
          mocked: v.mocked,
          producedAt: new Date().toISOString(),
          via: 'concretization',
          ...(v.canvaDesignId ? { canvaDesignId: v.canvaDesignId } : {}),
          ...(v.editUrl ? { editUrl: v.editUrl } : {}),
        } as never,
        posts: { connect: [{ id: post.id }] },
      },
    });
    ids.push(asset.id);
  }
  return ids;
}

/**
 * Write the concretization payload onto item.metadata.concretization (merging existing metadata).
 */
async function saveConcretizationOnItem(itemId: string, payload: ConcretizationPayload): Promise<void> {
  const item = await db.strategyItem.findUnique({ where: { id: itemId }, select: { metadata: true } });
  const existing = (item?.metadata as Record<string, unknown> | null) ?? {};
  // Also surface the most-read fields at the top level of metadata so
  // simpler consumers (tests, legacy UIs) don't need to dig through
  // `concretization`.
  const next: Record<string, unknown> = {
    ...existing,
    concretization: payload,
    caption: payload.caption,
    imageVariants: payload.variants,
  };
  if (payload.videoScript) {
    next.videoScript = `${payload.videoScript.hook ?? ''}\n${(payload.videoScript.scenes ?? []).map((s) => `${s.time}: ${s.visual} — ${s.voiceover}`).join('\n')}\nCTA: ${payload.videoScript.cta ?? ''}`.trim();
  }
  if (payload.emailSubject) next.emailSubject = payload.emailSubject;
  if (payload.emailBody) next.emailBody = payload.emailBody;
  await db.strategyItem.update({
    where: { id: itemId },
    data: { metadata: next as never },
  });
}

// =================================================================
// CAPTION / VIDEO / EMAIL DRIVERS
// =================================================================

interface CaptionDraft {
  caption: string;
  hashtags: string[];
  cta: string;
  extras?: Record<string, unknown>;
  mocked: boolean;
  provider: string;
}

async function produceCaption(
  prompt: string,
  item: StrategyItem,
  modelPrefs?: OrgModelPreferences,
): Promise<CaptionDraft> {
  const systemPrompt = [
    'You are a senior brand copywriter. Follow the brand DNA, voice, and constraints exactly.',
    'Always answer with VALID JSON only — no markdown, no commentary.',
  ].join('\n');

  try {
    const input = {
      prompt,
      systemPrompt,
      maxTokens: 1500,
      temperature: 0.7,
    };
    if (modelPrefs) AIModelPreferenceService.applyText(input as never, modelPrefs);
    const result = await AIRouterService.generateTextForTask('TEXT_SHORT_COPY', input);
    const parsed = extractJSON<Record<string, unknown>>(result.text);
    // Caption VIDE refusée : '' passait le test typeof, était persistée, et
    // rendait l'item « dégénéré » — re-concrétisation à chaque visite de page.
    if (parsed && typeof parsed.caption === 'string' && parsed.caption.trim().length > 0) {
      const hashtags = Array.isArray(parsed.hashtags) ? (parsed.hashtags as string[]) : (item.hashtags ?? []);
      const cta = typeof parsed.cta === 'string' ? parsed.cta : (item.cta ?? '');
      // Capture every other key as `extras` (slides, variants, tagline, partnerMention, etc.)
      const known = new Set(['caption', 'hashtags', 'cta']);
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) if (!known.has(k)) extras[k] = v;
      return {
        caption: parsed.caption as string,
        hashtags,
        cta,
        extras: Object.keys(extras).length ? extras : undefined,
        mocked: result.mocked,
        provider: String(result.provider ?? 'unknown'),
      };
    }
    // JSON parse failed — fall through to fallback below
    logger.warn('ConcretizationService.produceCaption: JSON parse failed, using fallback');
  } catch (err) {
    logger.warn('ConcretizationService.produceCaption failed', { err: (err as Error).message });
  }

  // Mock fallback
  return {
    caption: `[mock] ${item.title}\n\n${item.description ?? ''}`,
    hashtags: item.hashtags ?? [],
    cta: item.cta ?? 'Learn more',
    mocked: true,
    provider: 'mock',
  };
}

/**
 * Directeur artistique IA — convertit le prompt de base (qui embarque le brief
 * FR verbatim) en une SCÈNE visuelle pure, en anglais, sans aucun texte à
 * dessiner. Les générateurs d'images massacrent le lettrage (français surtout) :
 * quand le brief décrit le contenu du post, ils tentent de l'écrire dans
 * l'image. Ici : sujet, décor, action, lumière, composition, accents de la
 * charte — et interdiction explicite de texte. Repli : prompt d'origine.
 */
async function refineImagePrompt(
  rawPrompt: string,
  item: StrategyItem,
  modelPrefs?: OrgModelPreferences,
): Promise<string> {
  try {
    const input = {
      prompt:
        `Item: "${item.title}"\n${item.description ?? ''}\n\n` +
        `Base prompt (contains brief text — convert, don't copy): ${rawPrompt}`,
      systemPrompt:
        'You are an art director writing prompts for AI image generators. Convert the brief into ONE image-generation ' +
        'prompt in ENGLISH describing a concrete photographic or illustrative SCENE: subject, setting, action, mood, ' +
        'lighting, composition, and the brand color accents / visual style hints present in the base prompt. ' +
        'STRICT RULES: the image must contain absolutely NO text, NO words, NO letters, NO signage, NO logos — ' +
        'describe visuals only, never the post copy. Keep any aspect-ratio hint. Answer with the prompt only, no commentary.',
      maxTokens: 400,
      temperature: 0.6,
    };
    if (modelPrefs) AIModelPreferenceService.applyText(input as never, modelPrefs);
    const result = await AIRouterService.generateTextForTask('TEXT_SHORT_COPY', input);
    const refined = result.text?.trim();
    if (refined && !result.mocked && refined.length > 40) {
      return `${refined} Absolutely no text, letters, or typography anywhere in the image.`;
    }
  } catch (err) {
    logger.warn('ConcretizationService.refineImagePrompt failed — prompt de base conservé', {
      err: (err as Error).message,
    });
  }
  return rawPrompt;
}

async function produceVideoScript(prompt: string): Promise<ConcretizationVideoScript | undefined> {
  try {
    const result = await AIRouterService.generateTextForTask('TEXT_REEL_SCRIPT', {
      prompt,
      systemPrompt: 'Respond with valid JSON only.',
      maxTokens: 1500,
      temperature: 0.7,
    });
    const parsed = extractJSON<{
      hook?: string;
      scenes?: Array<{ time?: string; visual?: string; voiceover?: string }>;
      cta?: string;
    }>(result.text);
    if (parsed?.hook && parsed.scenes?.length) {
      return {
        hook: parsed.hook,
        scenes: parsed.scenes.map((s) => ({
          time: s.time ?? '',
          visual: s.visual ?? '',
          voiceover: s.voiceover ?? '',
        })),
        cta: parsed.cta,
        raw: result.text,
      };
    }
    // Fallback: model returned plain text instead of structured JSON.
    // Preserve it so consumers (UI, tests) still see a script string.
    if (typeof result.text === 'string' && result.text.trim().length > 0) {
      return {
        hook: result.text.trim(),
        scenes: [],
        raw: result.text,
      };
    }
  } catch (err) {
    logger.warn('ConcretizationService.produceVideoScript failed', { err: (err as Error).message });
  }
  return undefined;
}

async function produceEmailFields(subjectPrompt: string, bodyPrompt: string): Promise<ConcretizationEmailFields> {
  const systemPrompt = 'Respond with valid JSON only.';

  let subjects: string[] = [];
  let preheader: string | undefined;
  try {
    const subjectRes = await AIRouterService.generateTextForTask('TEXT_EMAIL', {
      prompt: subjectPrompt,
      systemPrompt,
      maxTokens: 600,
      temperature: 0.7,
    });
    const parsed = extractJSON<{ subjects?: string[]; preheader?: string }>(subjectRes.text);
    if (parsed?.subjects?.length) subjects = parsed.subjects;
    if (parsed?.preheader) preheader = parsed.preheader;
  } catch (err) {
    logger.warn('ConcretizationService.produceEmailFields: subject step failed', { err: (err as Error).message });
  }

  let body = '';
  let ctaLabel: string | undefined;
  let ctaUrl: string | null = null;
  try {
    const bodyRes = await AIRouterService.generateTextForTask('TEXT_EMAIL', {
      prompt: bodyPrompt,
      systemPrompt,
      maxTokens: 1800,
      temperature: 0.6,
    });
    const parsed = extractJSON<{ body?: string; ctaLabel?: string; ctaUrl?: string | null }>(bodyRes.text);
    if (parsed?.body) body = parsed.body;
    if (parsed?.ctaLabel) ctaLabel = parsed.ctaLabel;
    if (parsed?.ctaUrl !== undefined) ctaUrl = parsed.ctaUrl ?? null;
  } catch (err) {
    logger.warn('ConcretizationService.produceEmailFields: body step failed', { err: (err as Error).message });
  }

  if (!subjects.length) subjects = ['[mock] Sujet à compléter'];
  if (!body) body = '[mock] Corps de l\'email à compléter.';

  return {
    subject: subjects[0],
    subjectCandidates: subjects,
    preheader,
    body,
    ctaLabel,
    ctaUrl,
  };
}

// =================================================================
// SERVICE
// =================================================================

export const ConcretizationService = {
  /**
   * Take a StrategyItem and produce ready-to-publish content with a real preview.
   *
   * Pipeline:
   *   1. Load item + strategy + brand + profile + DNA
   *   2. Dispatch to the right buildForX based on item.kind
   *   3. Generate caption first via AIRouter.generateTextForTask
   *   4. If image needed → AIRouter.generateImageForTask (or N images for carousels)
   *   5. If video → produce video script + optional thumbnail
   *   6. If email → produce subject + body separately via TEXT_EMAIL
   *   7. Persist on item.metadata.concretization
   *   8. Persist images as MediaAsset rows on the linked Post
   */
  /**
   * Assistance IA à la demande (boutons de l'Acte 4) :
   *   - kind 'prompt'  → prompt visuel raffiné par le directeur artistique
   *     (scène pure, charte graphique, zéro texte à dessiner)
   *   - kind 'caption' → caption réécrite (contexte marque + ADN + mémoire
   *     stratégique) — retourne le texte prêt à coller dans l'éditeur.
   */
  async assist(opts: { itemId: string; kind: 'caption' | 'prompt' }): Promise<{ text: string; hashtags?: string[]; cta?: string; mocked: boolean }> {
    const { item, strategy, brand, dna } = await loadItemContext(opts.itemId);
    const built = buildPromptsForItem({
      item,
      brand: brand ? { id: brand.id, name: brand.name, industry: brand.industry } : null,
      brandProfile: brand?.profile ?? null,
      brandDna: dna,
    });
    const modelPrefs = await AIModelPreferenceService.forOrg(strategy.organizationId);

    if (opts.kind === 'prompt') {
      const base = built.imagePrompt
        ?? `Editorial social media image for "${item.title}". ${item.description ?? ''}`;
      const refined = await refineImagePrompt(base, item, modelPrefs);
      return { text: refined, mocked: refined === base };
    }

    const learned = await learnedStrategyBlock(strategy.organizationId, strategy.brandId);
    const caption = await produceCaption(`${built.captionPrompt}${learned}`, item, modelPrefs);
    const text = [caption.caption, caption.hashtags?.length ? caption.hashtags.join(' ') : '']
      .filter(Boolean)
      .join('\n\n');
    return { text, hashtags: caption.hashtags, cta: caption.cta, mocked: caption.mocked };
  },

  async concretizeItem(opts: { itemId: string; forceProvider?: string; userId?: string }): Promise<ConcretizationResult> {
    const { item, strategy, brand, dna } = await loadItemContext(opts.itemId);

    // Garde-fou budgétaire — la concrétisation est le plus gros consommateur
    // IA du produit (caption + prompt raffiné + 1-7 images + script + emails)
    // et n'était couverte par AUCUN contrôle.
    const budget = await AgentGuardrailService.checkBudget(strategy.organizationId).catch(() => ({ allowed: true as const, reason: '' }));
    if (!budget.allowed) {
      throw new Error(budget.reason || 'Budget IA mensuel atteint — augmente la limite dans Paramètres.');
    }

    // 2. Build prompts via the per-kind builder
    const built: BuilderOutput = buildPromptsForItem({
      item,
      brand: brand ? { id: brand.id, name: brand.name, industry: brand.industry } : null,
      brandProfile: brand?.profile ?? null,
      brandDna: dna,
    });

    const provider: RecommendedProvider | string = opts.forceProvider ?? built.recommendedProvider;

    // 3. Caption — préférences de modèle + mémoire stratégique (orientations
    // retenues par la marque) injectées dans le prompt.
    const modelPrefs = await AIModelPreferenceService.forOrg(strategy.organizationId);
    const learned = await learnedStrategyBlock(strategy.organizationId, strategy.brandId);
    const caption = await produceCaption(`${built.captionPrompt}${learned}`, item, modelPrefs);

    // 3b. Directeur artistique IA : le prompt visuel devient une scène pure,
    // sans texte à dessiner (fini les images au lettrage massacré).
    if (built.imagePrompt) {
      built.imagePrompt = await refineImagePrompt(built.imagePrompt, item, modelPrefs);
    }

    // Persistance PROGRESSIVE : le post + la caption sont sauvegardés dès
    // maintenant, puis chaque visuel dès qu'il est prêt. Un timeout serverless
    // en plein milieu ne perd plus TOUT le travail (avant: rien n'était écrit
    // avant la toute fin — jusqu'à 7 images séquentielles plus tard).
    const organizationId = strategy.organizationId;
    const post = await ensurePostForItem(item, organizationId, strategy.brandId);
    const variants: ConcretizationVariant[] = [];
    let persistedVariants = 0;
    const persistProgress = async (status: 'producing' | 'ready' = 'producing') => {
      try {
        if (post && variants.length > persistedVariants) {
          await persistVariantsToPost(post, variants.slice(persistedVariants));
          persistedVariants = variants.length;
        }
        await saveConcretizationOnItem(item.id, {
          imageUrls: variants.map((v) => v.url),
          variants,
          caption: caption.caption,
          hashtags: caption.hashtags,
          cta: caption.cta,
          provider: caption.provider,
          mocked: variants.length > 0 ? variants.every((v) => v.mocked) : caption.mocked,
          status,
          generatedAt: new Date().toISOString(),
          aspectRatio: built.aspectRatio,
          imagePrompt: built.imagePrompt ?? undefined,
          extras: caption.extras,
        });
      } catch (err) {
        logger.warn('Concretization: persistance progressive échouée', {
          itemId: item.id,
          err: (err as Error).message,
        });
      }
    };
    if (post) {
      await db.post.update({
        where: { id: post.id },
        data: {
          body: caption.caption,
          hashtags: caption.hashtags,
          cta: caption.cta || post.cta,
          aiPrompt: built.captionPrompt.slice(0, 8000),
          aiProvider: caption.provider,
          metadata: {
            ...((post.metadata as Record<string, unknown> | null) ?? {}),
            originStrategyItemId: item.id,
            lastConcretizationAt: new Date().toISOString(),
          } as never,
        },
      });
    }
    await persistProgress();
    const isCarousel = isCarouselItem(item);
    const carouselSlides = isCarousel
      ? Math.max(5, Math.min(7, Array.isArray(caption.extras?.slides) ? (caption.extras!.slides as unknown[]).length : 5))
      : 0;

    if (built.imagePrompt) {
      if (isCarousel && carouselSlides > 1) {
        // Carousel: generate N consistent slides with the same base style fragment
        for (let i = 0; i < carouselSlides; i++) {
          const slideExtras = Array.isArray(caption.extras?.slides) ? (caption.extras!.slides as Array<{ title?: string; body?: string }>) : [];
          const slideHint = slideExtras[i];
          const slidePrompt = [
            built.imagePrompt,
            `Slide ${i + 1} of ${carouselSlides}.`,
            slideHint?.title ? `Slide concept: ${slideHint.title}.` : '',
            slideHint?.body ? `Detail: ${slideHint.body}.` : '',
            'Maintain visual consistency with the other slides in this carousel.',
          ].filter(Boolean).join(' ');
          variants.push(await generateOneImage(slidePrompt, built.aspectRatio, provider, organizationId, modelPrefs, !!opts.forceProvider));
          await persistProgress();
        }
      } else {
        variants.push(await generateOneImage(built.imagePrompt, built.aspectRatio, provider, organizationId, modelPrefs, !!opts.forceProvider));
        await persistProgress();
      }
    }

    // 4b. Canva variant — only when a CanvaTemplate is linked to the brand.
    // Skipped silently otherwise (Auto-skip Canva si pas de template).
    if (built.imagePrompt && strategy.brandId) {
      const canvaVariant = await tryCanvaVariant({
        brandId: strategy.brandId,
        organizationId: strategy.organizationId,
        prompt: built.imagePrompt,
        caption: caption.caption,
        hashtags: caption.hashtags,
        aspect: built.aspectRatio,
      });
      if (canvaVariant) {
        variants.push(canvaVariant);
        await persistProgress();
      }
    }

    // 5. Video
    let videoScript: ConcretizationVideoScript | undefined;
    if (built.videoScriptPrompt) {
      videoScript = await produceVideoScript(built.videoScriptPrompt);
      // Optional thumbnail when no variant was produced yet
      if (variants.length === 0 && built.imagePrompt) {
        variants.push(await generateOneImage(built.imagePrompt, built.aspectRatio, provider, organizationId, modelPrefs, !!opts.forceProvider));
        await persistProgress();
      }
    }

    // 6. Email
    let emailFields: ConcretizationEmailFields | undefined;
    if (built.emailObjectPrompt && built.emailBodyPrompt) {
      emailFields = await produceEmailFields(built.emailObjectPrompt, built.emailBodyPrompt);
    }

    // 8. Finalisation — les MediaAssets ont déjà été persistés au fil de l'eau;
    // on ne persiste ici que les retardataires éventuels.
    // Producing/updating a post for a strategy item changes the next-action
    // snapshot (strategy-execute / visuals-pending counts) — drop the advisory
    // cache so the dashboard reflects this pipeline step on next load.
    invalidate(`nextaction:${organizationId}`);
    if (post && variants.length > persistedVariants) {
      await persistVariantsToPost(post, variants.slice(persistedVariants));
      persistedVariants = variants.length;
    }

    // Statut final du post maintenant que tout est là.
    if (post) {
      await db.post.update({
        where: { id: post.id },
        data: { status: 'PENDING_APPROVAL' },
      });
    }

    const overallMocked = (variants.length > 0 && variants.every((v) => v.mocked))
      || (variants.length === 0 && caption.mocked);

    await logAiSpend(
      organizationId,
      [
        { type: 'TEXT', provider: caption.provider, mocked: caption.mocked },
        ...variants.map((v) => ({ type: 'IMAGE' as const, provider: v.provider, mocked: v.mocked })),
      ],
      item.title,
    );

    // 7. Persist on item.metadata.concretization
    const payload: ConcretizationPayload = {
      imageUrls: variants.map((v) => v.url),
      variants,
      caption: caption.caption,
      hashtags: caption.hashtags,
      cta: caption.cta,
      videoScript,
      emailSubject: emailFields?.subject,
      emailBody: emailFields?.body,
      emailFields,
      provider: caption.provider,
      mocked: overallMocked,
      status: 'producing',
      generatedAt: new Date().toISOString(),
      aspectRatio: built.aspectRatio,
      imagePrompt: built.imagePrompt ?? undefined,
      extras: caption.extras,
    };
    await saveConcretizationOnItem(item.id, payload);

    return {
      itemId: item.id,
      postId: post?.id ?? null,
      variants,
      caption: caption.caption,
      hashtags: caption.hashtags,
      cta: caption.cta,
      videoScript,
      emailFields,
      provider: caption.provider,
      mocked: overallMocked,
      status: payload.status,
      aspectRatio: built.aspectRatio,
      extras: caption.extras,
      ...visualOutcome(variants, built.imagePrompt),
    };
  },

  /**
   * Regenerate ONLY the visual(s) for an already-concretized item.
   * Keeps caption / hashtags / cta untouched.
   */
  async regenerateVisual(opts: { itemId: string; providerOverride?: string; userId?: string }): Promise<ConcretizationResult> {
    const { item, strategy, brand, dna } = await loadItemContext(opts.itemId);

    const budget = await AgentGuardrailService.checkBudget(strategy.organizationId).catch(() => ({ allowed: true as const, reason: '' }));
    if (!budget.allowed) {
      throw new Error(budget.reason || 'Budget IA mensuel atteint — augmente la limite dans Paramètres.');
    }

    const existing = ((item.metadata as Record<string, unknown> | null)?.concretization ?? null) as ConcretizationPayload | null;
    if (!existing) {
      // No prior concretization — defer to the full pipeline
      return this.concretizeItem({ itemId: opts.itemId, forceProvider: opts.providerOverride });
    }

    const built = buildPromptsForItem({
      item,
      brand: brand ? { id: brand.id, name: brand.name, industry: brand.industry } : null,
      brandProfile: brand?.profile ?? null,
      brandDna: dna,
    });

    const provider = opts.providerOverride ?? built.recommendedProvider;

    const variants: ConcretizationVariant[] = [];
    if (built.imagePrompt) {
      // Prompt STOCKÉ prioritaire : c'est celui affiché et éventuellement
      // édité par l'utilisateur à l'Acte 4 (« Éditer prompt source »).
      // Sans cela, la régénération ignorait toute retouche manuelle.
      if (existing.imagePrompt && existing.imagePrompt.trim().length > 0) {
        built.imagePrompt = existing.imagePrompt;
      } else {
        // Même directeur artistique IA qu'à la concrétisation initiale.
        built.imagePrompt = await refineImagePrompt(built.imagePrompt, item);
      }
      const isCarousel = isCarouselItem(item);
      const slidesHint = Array.isArray(existing.extras?.slides)
        ? (existing.extras!.slides as Array<{ title?: string; body?: string }>)
        : [];
      const slides = isCarousel ? Math.max(5, Math.min(7, slidesHint.length || 5)) : 1;

      for (let i = 0; i < slides; i++) {
        const slideHint = slidesHint[i];
        const slidePrompt = isCarousel
          ? [
              built.imagePrompt,
              `Slide ${i + 1} of ${slides}.`,
              slideHint?.title ? `Slide concept: ${slideHint.title}.` : '',
              'Maintain visual consistency with the other slides.',
            ].filter(Boolean).join(' ')
          : built.imagePrompt;
        variants.push(await generateOneImage(slidePrompt, built.aspectRatio, provider, strategy.organizationId, undefined, !!opts.providerOverride));
      }
    }

    const post = await ensurePostForItem(item, strategy.organizationId, strategy.brandId);
    if (post && variants.length > 0) await persistVariantsToPost(post, variants);

    await logAiSpend(
      strategy.organizationId,
      variants.map((v) => ({ type: 'IMAGE' as const, provider: v.provider, mocked: v.mocked })),
      item.title,
    );

    const overallMocked = variants.length > 0 ? variants.every((v) => v.mocked) : existing.mocked;

    const payload: ConcretizationPayload = {
      ...existing,
      imageUrls: variants.length > 0 ? variants.map((v) => v.url) : existing.imageUrls,
      variants: variants.length > 0 ? variants : existing.variants,
      provider: variants[0]?.provider ?? existing.provider,
      mocked: overallMocked,
      status: existing.status === 'ready' ? 'ready' : 'producing',
      aspectRatio: built.aspectRatio,
      imagePrompt: built.imagePrompt ?? existing.imagePrompt,
      generatedAt: new Date().toISOString(),
    };
    await saveConcretizationOnItem(item.id, payload);

    return {
      itemId: item.id,
      postId: post?.id ?? null,
      variants: payload.variants,
      caption: payload.caption,
      hashtags: payload.hashtags,
      cta: payload.cta,
      videoScript: payload.videoScript,
      emailFields: payload.emailFields,
      provider: payload.provider,
      mocked: payload.mocked,
      status: payload.status,
      aspectRatio: payload.aspectRatio,
      extras: payload.extras,
      ...visualOutcome(payload.variants, built.imagePrompt),
    };
  },

  /**
   * List the concretization status of every item in a pipeline.
   * Status is derived from item.metadata.concretization.status (or 'pending' if absent).
   */
  async listConcretizedItems(pipelineId: string): Promise<Array<{
    itemId: string;
    status: ConcretizationStatus;
    concretization?: ConcretizationPayload;
  }>> {
    const pipeline = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
    if (!pipeline) return [];

    const where = pipeline.strategyId
      ? { strategyId: pipeline.strategyId }
      : pipeline.brandId
        ? { strategy: { brandId: pipeline.brandId } }
        : null;
    if (!where) return [];

    const items = await db.strategyItem.findMany({
      where,
      orderBy: { order: 'asc' },
      select: { id: true, metadata: true },
    });

    return items.map((it) => {
      const meta = (it.metadata as Record<string, unknown> | null) ?? {};
      const c = meta.concretization as ConcretizationPayload | undefined;
      const status: ConcretizationStatus = c?.status ?? 'pending';
      return { itemId: it.id, status, concretization: c };
    });
  },

  /**
   * Mark an already-concretized item as READY for share/schedule/publish.
   * Stores readyAt + the user who validated it.
   */
  async markItemReady(
    itemIdOrOpts: string | { itemId: string; userId?: string },
    maybeUserId?: string,
  ): Promise<ConcretizationPayload> {
    const itemId = typeof itemIdOrOpts === 'string' ? itemIdOrOpts : itemIdOrOpts.itemId;
    const userId = typeof itemIdOrOpts === 'string' ? maybeUserId : itemIdOrOpts.userId;
    let item = await db.strategyItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error('Item not found');

    // Le Post lié est la source de vérité : on synchronise sa dernière version
    // (texte édité au Studio, visuels attachés) AVANT de valider — sinon on
    // marquait « prêt » une copie périmée qui n'était pas ce qui allait partir.
    if (item.postId) {
      const { syncPostToStrategyItem } = await import('@/lib/post-item-sync');
      await syncPostToStrategyItem(item.postId);
      item = (await db.strategyItem.findUnique({ where: { id: itemId } })) ?? item;
    }

    const meta = (item.metadata as Record<string, unknown> | null) ?? {};
    let existing = meta.concretization as ConcretizationPayload | undefined;
    // Allow marking ready when the item has at least a caption + a visual
    // recorded directly on metadata (legacy/test shape, no nested
    // concretization payload yet).
    if (!existing) {
      const caption =
        (meta.caption as string | undefined) ?? (meta.copy as string | undefined) ?? null;
      const variants =
        (meta.imageVariants as unknown[] | undefined) ??
        (meta.images as unknown[] | undefined) ??
        (meta.visuals as unknown[] | undefined) ??
        [];
      const hasContent = (caption && caption.length > 0) || variants.length > 0;
      if (!hasContent) throw new Error('Item has not been concretized yet');
      const variantList = variants as Array<{ url?: string }>;
      const urls = variantList.map((v) => v?.url ?? '').filter(Boolean);
      existing = {
        imageUrls: urls,
        variants: variantList.map((v) => ({ url: v?.url ?? '' })) as ConcretizationVariant[],
        caption: caption ?? '',
        hashtags: [],
        cta: '',
        provider: 'legacy',
        mocked: false,
        status: 'pending',
        generatedAt: new Date().toISOString(),
        aspectRatio: '1:1',
      } satisfies ConcretizationPayload;
    }

    const readyAt = new Date().toISOString();
    const next: ConcretizationPayload = {
      ...existing,
      status: 'ready',
      readyAt,
    };

    await db.strategyItem.update({
      where: { id: itemId },
      data: {
        metadata: {
          ...meta,
          concretization: next,
          status: 'ready',
          readyAt,
          readyById: userId ?? null,
        } as never,
      },
    });

    return next;
  },
};

export type ConcretizationServiceType = typeof ConcretizationService;
