/**
 * ContentProductionService — turn a strategy item (or DRAFT post) into ready-to-publish
 * content via AI.
 *
 * Pipeline:
 *   1. generatePromptsForItem  → Claude/GPT writes the image / video / caption prompts
 *      derived from the item's kind, title, description, platform & format.
 *      Brand DNA fragment is injected when available.
 *   2. produceVisualsForPost   → fan-out across providers (gemini, dalle, flux) to get
 *      1-3 image variants. Optionally creates a Canva design from a brand template.
 *   3. produceVideoScriptForPost → AIRouter TEXT_REEL_SCRIPT.
 *   4. persistProducedAssets   → save MediaAsset rows linked to the post and flip
 *      its status to PENDING_APPROVAL (this schema's equivalent of READY_FOR_REVIEW).
 *
 * All adapters degrade to mocks if no API keys are configured (existing pattern).
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { GeminiService } from '@/services/ai/GeminiService';
import { BrandDNAService } from '@/services/intelligence/BrandDNAService';
import { CanvaService } from '@/services/canva/CanvaService';
import type { SupportFormat, StrategyItem, Brand, BrandProfile, Post } from '@prisma/client';

// =================================================================
// TYPES
// =================================================================

export type VisualProvider = 'gemini' | 'dalle' | 'flux' | 'canva';

export interface ProducedPrompts {
  imagePrompt: string;
  videoPrompt?: string;
  captionPrompt: string;
  aspectRatio: '1:1' | '4:5' | '9:16' | '16:9';
  reasoning?: string;
  mocked: boolean;
}

export interface ProducedVisualVariant {
  provider: VisualProvider | 'mock';
  url: string;
  prompt: string;
  mocked: boolean;
}

export interface ProducedVisualsResult {
  variants: ProducedVisualVariant[];
  canvaDesign?: { id: string; editUrl: string };
}

export interface ProducedVideoScriptResult {
  script: string;
  hook: string;
  scenes: Array<{ time: string; visual: string; voiceover: string }>;
  cta?: string;
  mocked: boolean;
}

// =================================================================
// HELPERS
// =================================================================

/**
 * Pick the best aspect ratio for a platform/format combination.
 */
function aspectRatioFor(
  format: SupportFormat | string | null | undefined,
  platform?: string | null,
): '1:1' | '4:5' | '9:16' | '16:9' {
  const f = String(format ?? '').toUpperCase();
  const p = String(platform ?? '').toLowerCase();

  // Vertical formats
  if (
    f.includes('REEL') || f.includes('STORY') || f.includes('SHORT') || f.includes('TIKTOK') ||
    p.includes('tiktok') || p.includes('reel') || p.includes('story') || p.includes('short')
  ) {
    return '9:16';
  }
  // Wide formats
  if (
    f.includes('THUMBNAIL') || f.includes('BANNER') || f.includes('WEB_BANNER') ||
    f === 'YOUTUBE_THUMBNAIL'
  ) {
    return '16:9';
  }
  // Portrait social (IG feed, Pinterest)
  if (f === 'INSTAGRAM_POST' || f === 'INSTAGRAM_CAROUSEL' || f === 'PINTEREST_PIN') {
    return '4:5';
  }
  // LinkedIn / Facebook / Twitter / generic ad
  if (f === 'LINKEDIN_POST' || f === 'FACEBOOK_POST' || f === 'TWITTER_POST' || f === 'AD_VISUAL') {
    return '1:1';
  }
  return '1:1';
}

/**
 * Load a post with everything we need (brand + profile + originating strategy item).
 */
async function loadPostContext(postId: string): Promise<{
  post: Post;
  brand: (Brand & { profile: BrandProfile | null }) | null;
  strategyItem: StrategyItem | null;
}> {
  const post = await db.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error(`Post ${postId} not found`);

  const brand = post.brandId
    ? await db.brand.findUnique({
        where: { id: post.brandId },
        include: { profile: true },
      })
    : null;

  const meta = (post.metadata as Record<string, unknown> | null) ?? {};
  const originId = typeof meta.originStrategyItemId === 'string' ? meta.originStrategyItemId : null;
  const strategyItem = originId
    ? await db.strategyItem.findUnique({ where: { id: originId } })
    : null;

  return { post, brand, strategyItem };
}

/**
 * Build the brand DNA prompt fragment if available.
 */
async function brandFragmentFor(brandId: string | null | undefined): Promise<string> {
  if (!brandId) return '';
  try {
    const dna = await BrandDNAService.getStoredFor(brandId);
    if (dna) return BrandDNAService.buildPromptFragment(dna);
  } catch (err) {
    logger.warn('ContentProductionService: DNA fetch failed', { brandId, err: (err as Error).message });
  }
  return '';
}

/**
 * Safely parse the first JSON object found in a string.
 */
function extractJSON<T = unknown>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// =================================================================
// SERVICE
// =================================================================

export const ContentProductionService = {
  /**
   * Ask the router (TEXT_STRUCTURED_JSON) to generate prompts derived from a
   * strategy item OR a draft post. Brand DNA is injected if present.
   *
   * `item` accepts a partial shape so callers can pass a real StrategyItem,
   * a draft Post (mapped), or just an ad-hoc descriptor.
   */
  async generatePromptsForItem(opts: {
    item: {
      kind?: string | null;            // e.g. POST_IDEA, REEL_IDEA
      title?: string | null;
      description?: string | null;
      platform?: string | null;
      format?: SupportFormat | string | null;
      cta?: string | null;
      hashtags?: string[] | null;
    };
    brand?: {
      id?: string | null;
      name?: string | null;
      industry?: string | null;
    } | null;
  }): Promise<ProducedPrompts> {
    const { item, brand } = opts;
    const aspect = aspectRatioFor(item.format, item.platform);
    const dnaFragment = brand?.id ? await brandFragmentFor(brand.id) : '';

    const systemPrompt = [
      'Tu es un directeur de création senior. À partir d\'un item de stratégie marketing,',
      'tu rédiges les prompts EXACTS pour : (1) générer une image IA, (2) générer un',
      'script vidéo si pertinent, (3) générer la caption sociale finale.',
      '',
      'Réponds UNIQUEMENT en JSON valide, sans markdown :',
      '{',
      '  "imagePrompt": "prompt détaillé pour générateur d\'image (sujet, composition, lumière, style, mood, palette)",',
      '  "videoPrompt": "prompt pour script vidéo (null si format non-vidéo)",',
      '  "captionPrompt": "instruction pour Claude/GPT pour générer la caption finale (ton, longueur, structure, CTA, hashtags)",',
      '  "reasoning": "1 phrase expliquant les choix créatifs"',
      '}',
      '',
      `Format cible : ${item.format ?? 'générique'} (${aspect}).`,
      'Le prompt image doit être en anglais (les modèles d\'image perfent mieux en EN).',
      'Le prompt caption et videoPrompt restent dans la langue du brief.',
      dnaFragment ? `\n${dnaFragment}` : '',
    ].filter(Boolean).join('\n');

    const userPrompt = [
      `Marque : ${brand?.name ?? '(non spécifiée)'}${brand?.industry ? ` — ${brand.industry}` : ''}`,
      `Type : ${item.kind ?? 'POST_IDEA'}`,
      `Plateforme : ${item.platform ?? '(générique)'}`,
      `Format : ${item.format ?? '(non spécifié)'}`,
      `Titre : ${item.title ?? '(sans titre)'}`,
      `Description : ${item.description ?? '(pas de description)'}`,
      item.cta ? `CTA souhaité : ${item.cta}` : '',
      item.hashtags?.length ? `Hashtags suggérés : ${item.hashtags.join(' ')}` : '',
      '',
      'Génère les 3 prompts maintenant.',
    ].filter(Boolean).join('\n');

    try {
      const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 1500,
        temperature: 0.6,
      });
      const parsed = extractJSON<{
        imagePrompt?: string;
        videoPrompt?: string | null;
        captionPrompt?: string;
        reasoning?: string;
      }>(result.text);
      if (parsed?.imagePrompt && parsed?.captionPrompt) {
        return {
          imagePrompt: parsed.imagePrompt,
          videoPrompt: parsed.videoPrompt ?? undefined,
          captionPrompt: parsed.captionPrompt,
          aspectRatio: aspect,
          reasoning: parsed.reasoning,
          mocked: result.mocked,
        };
      }
      logger.warn('ContentProductionService.generatePromptsForItem: JSON parse failed');
    } catch (err) {
      logger.warn('ContentProductionService.generatePromptsForItem failed', { err: (err as Error).message });
    }

    // Fallback mock prompts
    const subject = item.title ?? item.description?.slice(0, 60) ?? 'brand content';
    const isVideo =
      String(item.format ?? '').toUpperCase().includes('REEL') ||
      String(item.format ?? '').toUpperCase().includes('VIDEO') ||
      String(item.format ?? '').toUpperCase().includes('SHORT');
    return {
      imagePrompt: `Editorial photo of ${subject}, ${brand?.industry ?? 'modern lifestyle'}, soft natural light, shallow depth of field, ${aspect}, vibrant but tasteful palette`,
      videoPrompt: isVideo
        ? `Script vidéo court (~30s) sur "${subject}", hook fort, 3 scènes, CTA final${item.cta ? ` "${item.cta}"` : ''}.`
        : undefined,
      captionPrompt: `Rédige une caption ${item.platform ?? 'sociale'} pour "${subject}". Ton aligné avec ${brand?.name ?? 'la marque'}. ${item.cta ? `Inclure le CTA "${item.cta}". ` : ''}Inclure 5-10 hashtags pertinents.`,
      aspectRatio: aspect,
      reasoning: 'Mock fallback (router unavailable).',
      mocked: true,
    };
  },

  /**
   * Generate 1-3 image variants for a post.
   *
   * - providers : ordered preference list. Default = try gemini first, then dalle.
   *   Each provider that returns counts as a variant (max 3).
   * - If the brand has a Canva template URL stored on its profile metadata,
   *   we additionally create a CanvaDesign row via CanvaService.
   */
  async produceVisualsForPost(opts: {
    postId: string;
    providers?: VisualProvider[];
    maxVariants?: number;
  }): Promise<ProducedVisualsResult> {
    const providers = opts.providers ?? ['gemini', 'dalle'];
    const maxVariants = Math.max(1, Math.min(3, opts.maxVariants ?? providers.length));

    const { post, brand, strategyItem } = await loadPostContext(opts.postId);

    // 1) Build prompts (re-use generatePromptsForItem so DNA + format heuristics apply)
    const prompts = await this.generatePromptsForItem({
      item: {
        kind: strategyItem?.kind ?? 'POST_IDEA',
        title: post.title ?? strategyItem?.title ?? null,
        description: post.body ?? strategyItem?.description ?? null,
        platform: strategyItem?.platform ?? null,
        format: post.format,
        cta: post.cta ?? strategyItem?.cta ?? null,
        hashtags: post.hashtags?.length ? post.hashtags : strategyItem?.hashtags ?? null,
      },
      brand: brand ? { id: brand.id, name: brand.name, industry: brand.industry } : null,
    });

    // 2) Fan-out across providers
    const variants: ProducedVisualVariant[] = [];
    for (const provider of providers.slice(0, maxVariants)) {
      try {
        if (provider === 'gemini') {
          const out = await GeminiService.generateImage({
            prompt: prompts.imagePrompt,
            aspectRatio: prompts.aspectRatio,
          });
          variants.push({
            provider: 'gemini',
            url: out.url,
            prompt: prompts.imagePrompt,
            mocked: out.mocked,
          });
        } else if (provider === 'dalle') {
          const out = await AIRouterService.generateImageForTask('IMAGE_AD_WITH_TEXT', {
            prompt: prompts.imagePrompt,
            aspectRatio: prompts.aspectRatio,
          });
          variants.push({
            provider: 'dalle',
            url: out.url,
            prompt: prompts.imagePrompt,
            mocked: out.mocked,
          });
        } else if (provider === 'flux') {
          const out = await AIRouterService.generateImageForTask('IMAGE_PHOTOREALISTIC', {
            prompt: prompts.imagePrompt,
            aspectRatio: prompts.aspectRatio,
          });
          variants.push({
            provider: 'flux',
            url: out.url,
            prompt: prompts.imagePrompt,
            mocked: out.mocked,
          });
        } else if (provider === 'canva') {
          // Uses the brand's Canva template if one is linked; otherwise the
          // CanvaService falls back to a mock — never throws.
          const out = await AIRouterService.generateImageViaCanva({
            prompt: prompts.imagePrompt,
            aspectRatio: prompts.aspectRatio,
            brandId: brand?.id,
          });
          variants.push({
            provider: 'canva',
            url: out.url,
            prompt: prompts.imagePrompt,
            mocked: out.mocked,
          });
        }
      } catch (err) {
        logger.warn('ContentProductionService.produceVisualsForPost: provider failed', {
          provider,
          err: (err as Error).message,
        });
      }
    }

    if (variants.length === 0) {
      // Guarantee at least one mocked variant so downstream logic has something to persist.
      variants.push({
        provider: 'mock',
        url: `https://placehold.co/1024x1024/png?text=${encodeURIComponent(post.title?.slice(0, 40) ?? 'preview')}`,
        prompt: prompts.imagePrompt,
        mocked: true,
      });
    }

    // 3) Optional Canva design if the brand has a stored template URL
    let canvaDesign: { id: string; editUrl: string } | undefined;
    try {
      const profileLinks = (brand?.profile?.importantLinks as Record<string, unknown> | null) ?? {};
      const templateUrl =
        typeof profileLinks._canvaTemplateUrl === 'string' ? profileLinks._canvaTemplateUrl : null;
      if (templateUrl && brand) {
        const created = await CanvaService.createFromTemplate(
          {
            brandId: brand.id,
            templateUrl,
            title: post.title ?? 'Generated design',
            brief: prompts.imagePrompt,
          },
          post.organizationId,
        );
        canvaDesign = { id: created.id, editUrl: created.url };
      }
    } catch (err) {
      logger.warn('ContentProductionService.produceVisualsForPost: canva step skipped', {
        err: (err as Error).message,
      });
    }

    return { variants, canvaDesign };
  },

  /**
   * Generate a short video script using AIRouter TEXT_REEL_SCRIPT.
   * Returns a structured object (hook, scenes, CTA).
   */
  async produceVideoScriptForPost(opts: { postId: string }): Promise<ProducedVideoScriptResult> {
    const { post, brand, strategyItem } = await loadPostContext(opts.postId);
    const dnaFragment = brand?.id ? await brandFragmentFor(brand.id) : '';

    const subject = post.title ?? strategyItem?.title ?? post.body?.slice(0, 80) ?? 'brand topic';
    const description = post.body ?? strategyItem?.description ?? '';

    const systemPrompt = [
      'Tu es un scénariste senior pour Reels / TikTok / Shorts.',
      'Tu écris des scripts courts (15-45s) avec :',
      '  - un HOOK de 1-2 secondes percutant,',
      '  - 3 à 5 scènes très courtes (chacune : visual + voiceover),',
      '  - un CTA final clair.',
      '',
      'Réponds UNIQUEMENT en JSON valide :',
      '{',
      '  "hook": "phrase d\'accroche 1-2s",',
      '  "scenes": [ { "time": "0-3s", "visual": "...", "voiceover": "..." } ],',
      '  "cta": "appel à l\'action final"',
      '}',
      dnaFragment ? `\n${dnaFragment}` : '',
    ].filter(Boolean).join('\n');

    const userPrompt = [
      `Marque : ${brand?.name ?? '(non spécifiée)'}`,
      `Sujet : ${subject}`,
      description ? `Description : ${description}` : '',
      post.cta ? `CTA souhaité : ${post.cta}` : '',
      'Format : Reel/Short vertical 9:16, durée 20-30s.',
      'Génère le script maintenant.',
    ].filter(Boolean).join('\n');

    try {
      const result = await AIRouterService.generateTextForTask('TEXT_REEL_SCRIPT', {
        prompt: userPrompt,
        systemPrompt,
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
          script: result.text,
          hook: parsed.hook,
          scenes: parsed.scenes.map((s) => ({
            time: s.time ?? '',
            visual: s.visual ?? '',
            voiceover: s.voiceover ?? '',
          })),
          cta: parsed.cta,
          mocked: result.mocked,
        };
      }
    } catch (err) {
      logger.warn('ContentProductionService.produceVideoScriptForPost failed', {
        err: (err as Error).message,
      });
    }

    // Mock fallback
    return {
      script: `[MOCK] Script pour "${subject}"`,
      hook: `Tu savais que ${subject} ?`,
      scenes: [
        { time: '0-3s', visual: 'Plan large produit', voiceover: `Hook fort sur ${subject}.` },
        { time: '3-10s', visual: 'Close-up détail', voiceover: 'Le problème que ça résout.' },
        { time: '10-20s', visual: 'Démo rapide', voiceover: 'Comment ça marche en 1 phrase.' },
        { time: '20-25s', visual: 'CTA visuel', voiceover: post.cta ?? 'Découvre maintenant.' },
      ],
      cta: post.cta ?? 'Découvre maintenant.',
      mocked: true,
    };
  },

  /**
   * Persist visuals as MediaAsset rows linked to the post, then move the post to
   * PENDING_APPROVAL (the schema's equivalent of "READY_FOR_REVIEW").
   */
  async persistProducedAssets(opts: {
    postId: string;
    variants: ProducedVisualVariant[];
    canvaDesign?: { id: string; editUrl: string };
  }): Promise<{ mediaAssetIds: string[]; postStatus: 'PENDING_APPROVAL' }> {
    const post = await db.post.findUnique({ where: { id: opts.postId } });
    if (!post) throw new Error(`Post ${opts.postId} not found`);

    const createdIds: string[] = [];
    for (const v of opts.variants) {
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
          } as never,
          posts: { connect: [{ id: post.id }] },
        },
      });
      createdIds.push(asset.id);
    }

    const existingMeta = (post.metadata as Record<string, unknown> | null) ?? {};
    const nextMeta: Record<string, unknown> = {
      ...existingMeta,
      lastProductionAt: new Date().toISOString(),
      lastProductionVariants: createdIds,
    };
    if (opts.canvaDesign) {
      nextMeta.canvaDesign = opts.canvaDesign;
    }

    await db.post.update({
      where: { id: post.id },
      data: {
        status: 'PENDING_APPROVAL',
        metadata: nextMeta as never,
      },
    });

    return { mediaAssetIds: createdIds, postStatus: 'PENDING_APPROVAL' };
  },
};

export type ContentProductionServiceType = typeof ContentProductionService;
