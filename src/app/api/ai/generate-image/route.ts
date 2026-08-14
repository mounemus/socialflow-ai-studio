import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { GeminiService } from '@/services/ai/GeminiService';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';
import { AIModelPreferenceService } from '@/services/ai/AIModelPreferenceService';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';
import { estimateAiCostCents } from '@/lib/ai-cost';
import { isPlaceholderVisualUrl } from '@/lib/post-media';

const schema = z.object({
  prompt: z.string().min(3).max(2000),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9']).default('1:1'),
  styleHint: z.string().optional(),
  variants: z.number().int().min(1).max(4).default(1),
  brandId: z.string().optional(),
  // 'auto' lets the router pick the best available provider; the others force one.
  provider: z.enum(['auto', 'flux', 'dalle', 'gemini', 'stability']).default('auto'),
  saveToMediaLibrary: z.boolean().default(true),
});

export const maxDuration = 90;

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  // Garde-fou budgétaire — n'était câblé que sur la vidéo alors que l'image
  // est la dépense la plus fréquente (jusqu'à 4 variantes par requête).
  const budget = await AgentGuardrailService.checkBudget(ctx.organizationId);
  if (!budget.allowed) {
    return ok({ images: [], blocked: true, reason: budget.reason });
  }

  // Optional brand context: enrich the prompt with brand visual style
  let enrichedPrompt = body.prompt;
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      include: { profile: true },
    });
    if (brand?.profile?.visualStyle) {
      enrichedPrompt = `${body.prompt}, ${brand.profile.visualStyle}`;
    }
  }

  const start = Date.now();
  const results = [];
  const prefs = await AIModelPreferenceService.forOrg(ctx.organizationId);

  // Generate ONE image with the chosen provider (or router auto-pick).
  // Uses AIRouterService (auto-detects REPLICATE/STABILITY/OPENAI keys — no
  // ENABLE_REAL_AI gate) + GeminiService for the Gemini "Nano Banana" model.
  async function genOne(): Promise<{ url: string; provider: string; mocked: boolean; error?: string }> {
    try {
      if (body.provider === 'gemini') {
        const out = await GeminiService.generateImage({
          prompt: enrichedPrompt,
          aspectRatio: body.aspectRatio,
          styleHint: body.styleHint,
        });
        return { url: out.url, provider: `gemini:${out.model}`, mocked: out.mocked };
      }
      // dalle → bias the task that prefers DALL-E (good text rendering);
      // flux/stability/auto → photorealistic chain (replicate → dalle → stability).
      const task = body.provider === 'dalle' ? 'IMAGE_AD_WITH_TEXT' : 'IMAGE_PHOTOREALISTIC';
      // Le choix de l'utilisateur doit être HONORÉ : sans `forceProvider`, le
      // routeur choisissait librement (demander « GPT Image » rendait un visuel
      // fal). 'auto' seul laisse le routeur décider.
      const FORCED: Record<string, 'fal' | 'dalle' | 'stability'> = {
        flux: 'fal',
        dalle: 'dalle',
        stability: 'stability',
      };
      const forced = FORCED[body.provider];
      // Ordre de priorité : préférence d'organisation d'abord, puis le choix
      // EXPLICITE de l'utilisateur par-dessus. Avant, applyImage mutait l'objet
      // APRÈS le spread : la préférence d'org écrasait le fournisseur demandé.
      const imageInput: { prompt: string; aspectRatio: typeof body.aspectRatio; styleHint?: string; forceProvider?: string; model?: string } = {
        prompt: enrichedPrompt,
        aspectRatio: body.aspectRatio,
        styleHint: body.styleHint,
      };
      AIModelPreferenceService.applyImage(imageInput as never, prefs);
      if (forced) {
        if (imageInput.forceProvider && imageInput.forceProvider !== forced) delete imageInput.model;
        imageInput.forceProvider = forced;
      }
      const out = await AIRouterService.generateImageForTask(task, imageInput as never);
      return { url: out.url, provider: String(out.provider), mocked: out.mocked };
    } catch (err) {
      return { url: '', provider: 'error', mocked: false, error: (err as Error).message };
    }
  }

  // Generate variants in parallel
  const promises = Array.from({ length: body.variants }, () => genOne());

  const generated = await Promise.all(promises);

  for (const g of generated) {
    if ('error' in g || !g.url) {
      results.push({ ok: false, error: ('error' in g ? g.error : 'Empty URL') });
      continue;
    }
    let mediaId: string | undefined;
    // Les images base64 (DALL-E) sont uploadées vers Supabase Storage → URL
    // publique, au lieu d'être ignorées (ou pire, stockées en base).
    if (g.url.startsWith('data:')) {
      const uploaded = await SupabaseStorageService.uploadDataUrl({
        organizationId: ctx.organizationId,
        dataUrl: g.url,
        prefix: 'studio',
      });
      if (uploaded) g.url = uploaded;
    }
    // On enregistre AUSSI les images base64 : elles sont servies publiquement
    // via /api/media/[id]/raw. Les exclure privait GPT Image / Gemini de leur
    // `mediaId` — donc du bouton « Utiliser pour ce post » — quand le stockage
    // externe n'est pas configuré.
    // Un placeholder de simulation (Gemini sans clé → placehold.co) n'entre
    // JAMAIS en médiathèque comme visuel réel.
    if (body.saveToMediaLibrary && !isPlaceholderVisualUrl(g.url)) {
      const media = await db.mediaAsset.create({
        data: {
          organizationId: ctx.organizationId,
          brandId: body.brandId,
          kind: 'IMAGE',
          url: g.url,
          source: 'ai',
          mimeType: 'image/png',
          altText: body.prompt.slice(0, 200),
          metadata: { prompt: body.prompt, provider: g.provider, aspectRatio: body.aspectRatio, mocked: g.mocked } as never,
        },
      });
      mediaId = media.id;
    }
    results.push({
      ok: true,
      url: g.url,
      provider: g.provider,
      mocked: g.mocked,
      mediaId,
    });
  }

  // Journal de coût/fiabilité : `metadata.provider` alimente les métriques de
  // routage (sans lui, les fournisseurs image n'apparaissaient jamais), et
  // `costCents` alimente le garde-fou budgétaire (sans lui, dépense = 0).
  const okResults = results.filter((r) => r.ok) as Array<{ provider?: string; mocked?: boolean }>;
  const mainProvider = okResults[0]?.provider ?? null;
  const costCents = okResults.reduce(
    (sum, r) => sum + (r.mocked ? 0 : estimateAiCostCents('IMAGE', r.provider)),
    0,
  );
  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'IMAGE',
      prompt: body.prompt,
      response: JSON.stringify(results.map((r) => ({ ok: r.ok, provider: 'provider' in r ? r.provider : null }))).slice(0, 1000),
      durationMs: Date.now() - start,
      success: results.some((r) => r.ok),
      costCents,
      metadata: { variants: body.variants, aspectRatio: body.aspectRatio, provider: mainProvider } as never,
    },
  });

  return ok({
    images: results,
    durationMs: Date.now() - start,
    promptUsed: enrichedPrompt,
  });
});
