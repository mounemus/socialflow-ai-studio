import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIModelPreferenceService } from '@/services/ai/AIModelPreferenceService';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';
import { estimateAiCostCents } from '@/lib/ai-cost';
import { replicateVideoAdapter, DEFAULT_VIDEO_MODEL } from '@/services/ai/adapters/replicate-video';
import { falAdapter, pickFalVideoModel } from '@/services/ai/adapters/fal';
import { higgsfieldAdapter, DEFAULT_HIGGSFIELD_VIDEO_MODEL } from '@/services/ai/adapters/higgsfield';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const postSchema = z.object({
  prompt: z.string().min(10).max(2000),
  brandId: z.string().optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
  /** Langue du CONTENU (voix off, textes à l'écran). Français par défaut. */
  language: z.string().default('fr'),
  /** Fournisseur choisi dans l'Atelier — 'auto' = préférence de l'organisation puis secours. */
  provider: z.enum(['auto', 'fal', 'replicate', 'higgsfield']).default('auto'),
  /** Modèle explicite (id du catalogue du fournisseur). */
  model: z.string().max(200).optional(),
});

/**
 * POST /api/ai/generate-video — lance une génération vidéo RÉELLE (Replicate).
 * Asynchrone assumé : retourne un predictionId à poller via GET ?id=.
 * Sans REPLICATE_API_TOKEN → indisponibilité honnête (aucune vidéo simulée).
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = postSchema.parse(await req.json());

  // Garantie de langue : la description visuelle peut rester en anglais
  // (meilleurs résultats), mais tout CONTENU audible ou lisible doit être
  // dans la langue demandée — français par défaut.
  const contentPrompt = body.language.toLowerCase().startsWith('en')
    ? body.prompt
    : `${body.prompt}\n\nIMPORTANT: all voice-over, dialogue, narration, captions and any readable on-screen text MUST be in FRENCH.`;

  if (!replicateVideoAdapter.isConfigured() && !falAdapter.isConfigured() && !higgsfieldAdapter.isConfigured()) {
    return ok({
      available: false,
      reason: 'REPLICATE_API_TOKEN, FAL_KEY et HIGGSFIELD_API_KEY_ID/SECRET manquants — la génération vidéo est indisponible (aucune simulation).',
    });
  }

  // La vidéo coûte cher — garde-fou budgétaire de l'agent appliqué.
  const budget = await AgentGuardrailService.checkBudget(ctx.organizationId);
  if (!budget.allowed) {
    return ok({ available: false, reason: budget.reason });
  }

  const prefs = await AIModelPreferenceService.forOrg(ctx.organizationId);
  // Choix explicite de l'Atelier > préférence FORCED de l'organisation.
  const forced: { provider: string; model: string | null } | null =
    body.provider !== 'auto'
      ? { provider: body.provider, model: body.model ?? null }
      : prefs.VIDEO.mode === 'FORCED'
        ? { provider: prefs.VIDEO.provider ?? '', model: prefs.VIDEO.model ?? null }
        : null;

  const logRequest = (provider: string, model: string, predictionId: string) =>
    db.aIRequest
      .create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          type: 'VIDEO' as never,
          prompt: body.prompt,
          costCents: estimateAiCostCents('VIDEO', provider),
          metadata: { provider, model, predictionId } as never,
        },
      })
      .catch(() => undefined);

  const launchFal = async () => {
    // Sans modèle imposé : sélection intelligente selon le contexte du prompt
    // (audio → Veo 3, clip long → Seedance 2.5, brouillon → Seedance Fast…).
    const model =
      forced?.provider === 'fal' && forced.model
        ? forced.model
        : pickFalVideoModel(body.prompt, body.aspectRatio);
    const prediction = await falAdapter.createVideoPrediction({
      prompt: contentPrompt,
      model,
      aspectRatio: body.aspectRatio,
    });
    // Id auto-descriptif "fal:{model}:{requestId}" — le polling GET reste
    // identique côté client, quel que soit le fournisseur.
    await logRequest('fal', prediction.model, prediction.id);
    return { predictionId: `fal:${prediction.model}:${prediction.id}`, model: prediction.model };
  };

  const launchReplicate = async () => {
    const model = forced?.provider === 'replicate' && forced.model ? forced.model : DEFAULT_VIDEO_MODEL;
    const prediction = await replicateVideoAdapter.createPrediction({
      prompt: contentPrompt,
      model,
      aspectRatio: body.aspectRatio,
    });
    await logRequest('replicate', model, prediction.id);
    return { predictionId: prediction.id, model };
  };

  // Ordre des fournisseurs : préférence FORCED en tête, puis l'autre en
  // SECOURS RÉEL — avant, un échec au lancement (402 crédit Replicate épuisé…)
  // remontait tel quel alors que fal.ai était configuré et crédité.
  // En AUTO, fal.ai passe en premier : même logique que la chaîne image
  // (URL hébergée, fiabilité observée), Replicate en second.
  const launchHiggsfield = async () => {
    const model = forced?.provider === 'higgsfield' && forced.model ? forced.model : DEFAULT_HIGGSFIELD_VIDEO_MODEL;
    const prediction = await higgsfieldAdapter.createVideoPrediction({
      prompt: contentPrompt,
      model,
      aspectRatio: body.aspectRatio,
    });
    await logRequest('higgsfield', model, prediction.id);
    return { predictionId: `higgsfield:${model}:${prediction.id}`, model };
  };

  type Launcher = { name: string; configured: boolean; launch: () => Promise<{ predictionId: string; model: string }> };
  const providers: Record<'fal' | 'replicate' | 'higgsfield', Launcher> = {
    fal: { name: 'fal', configured: falAdapter.isConfigured(), launch: launchFal },
    replicate: { name: 'replicate', configured: replicateVideoAdapter.isConfigured(), launch: launchReplicate },
    higgsfield: { name: 'higgsfield', configured: higgsfieldAdapter.isConfigured(), launch: launchHiggsfield },
  };
  const order: Array<keyof typeof providers> = ['fal', 'replicate', 'higgsfield'];
  // Choix explicite de l'Atelier : PAS de secours silencieux vers un autre
  // fournisseur (l'utilisateur a choisi, on lui dit si ça échoue).
  // En AUTO : fournisseur forcé par l'organisation en tête, les autres en
  // SECOURS RÉEL — un échec au lancement (402 crédit épuisé…) ne bloque pas.
  const preferred = forced && forced.provider in providers ? (forced.provider as keyof typeof providers) : null;
  const chain: Launcher[] =
    body.provider !== 'auto'
      ? [providers[body.provider]]
      : [...(preferred ? [providers[preferred]] : []), ...order.filter((k) => k !== preferred).map((k) => providers[k])];

  const failures: string[] = [];
  for (const p of chain) {
    if (!p.configured) {
      failures.push(`${p.name}: clé API non configurée`);
      continue;
    }
    try {
      const launched = await p.launch();
      return ok({ available: true, predictionId: launched.predictionId, status: 'PROCESSING', model: launched.model });
    } catch (err) {
      failures.push(`${p.name}: ${(err as Error).message.slice(0, 160)}`);
    }
  }

  return ok({
    available: false,
    reason: `Aucun fournisseur vidéo n'a accepté la génération — ${failures.join(' · ')}`,
  });
});

/**
 * GET /api/ai/generate-video?id=&brandId= — polling du statut.
 * succeeded → MediaAsset créé + URL retournée; failed → erreur explicite.
 */
/**
 * Enregistre la vidéo générée en médiathèque — IDEMPOTENT (deux polls qui se
 * chevauchent ne créent plus deux lignes : l'URL de sortie identifie la
 * prédiction). Une erreur DB n'est plus avalée : elle remonte au client, qui
 * l'affiche au lieu d'annoncer « ajoutée à la médiathèque » à tort.
 */
async function persistVideo(input: {
  organizationId: string;
  brandId: string | undefined;
  url: string;
  externalRef: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string | null; error?: string }> {
  try {
    const existing = await db.mediaAsset.findFirst({
      where: { organizationId: input.organizationId, kind: 'VIDEO', url: input.url },
      select: { id: true },
    });
    if (existing) return { id: existing.id };
    const created = await db.mediaAsset.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        kind: 'VIDEO',
        url: input.url,
        mimeType: 'video/mp4',
        source: 'ai',
        externalRef: input.externalRef,
        metadata: input.metadata as never,
      },
      select: { id: true },
    });
    return { id: created.id };
  } catch (err) {
    return { id: null, error: `Vidéo générée mais non enregistrée en médiathèque : ${(err as Error).message.slice(0, 120)}` };
  }
}

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) throw new Error('id requis');

  // Le brandId vient de la query : sans validation, un média pouvait être
  // rattaché à la marque d'une AUTRE organisation.
  const rawBrandId = url.searchParams.get('brandId');
  const brandId = rawBrandId
    ? (await db.brand.findFirst({
        where: { id: rawBrandId, organizationId: ctx.organizationId },
        select: { id: true },
      }))?.id ?? undefined
    : undefined;

  // Prédiction fal.ai — id encodé "fal:{model}:{requestId}".
  if (id.startsWith('fal:')) {
    const rest = id.slice(4);
    const sep = rest.lastIndexOf(':');
    const model = rest.slice(0, sep);
    const requestId = rest.slice(sep + 1);
    if (!model || !requestId) throw new Error('id fal invalide');
    const fp = await falAdapter.getVideoPrediction(requestId, model);
    if (fp.status === 'succeeded' && fp.outputUrl) {
      const media = await persistVideo({
        organizationId: ctx.organizationId,
        brandId,
        url: fp.outputUrl,
        externalRef: `fal:${fp.model}`,
        metadata: { predictionId: fp.id, model: fp.model, provider: 'fal' },
      });
      return ok({ status: 'READY', url: fp.outputUrl, mediaId: media.id, mediaError: media.error, model: fp.model });
    }
    if (fp.status === 'failed') {
      return ok({ status: 'FAILED', error: fp.error ?? 'Génération échouée côté fal.ai.' });
    }
    return ok({ status: 'PROCESSING' });
  }

  if (id.startsWith('higgsfield:')) {
    const rest = id.slice('higgsfield:'.length);
    const sep = rest.lastIndexOf(':');
    const model = rest.slice(0, sep);
    const requestId = rest.slice(sep + 1);
    if (!model || !requestId) throw new Error('id higgsfield invalide');
    const hp = await higgsfieldAdapter.getVideoPrediction(requestId, model);
    if (hp.status === 'succeeded' && hp.outputUrl) {
      const media = await persistVideo({
        organizationId: ctx.organizationId,
        brandId,
        url: hp.outputUrl,
        externalRef: `higgsfield:${model}`,
        metadata: { predictionId: requestId, model, provider: 'higgsfield' },
      });
      return ok({ status: 'READY', url: hp.outputUrl, mediaId: media.id, mediaError: media.error, model });
    }
    if (hp.status === 'failed') return ok({ status: 'FAILED', error: hp.error ?? 'Génération échouée côté Higgsfield.' });
    return ok({ status: 'PROCESSING' });
  }

  const p = await replicateVideoAdapter.getPrediction(id);
  if (p.status === 'succeeded' && p.outputUrl) {
    const media = await persistVideo({
      organizationId: ctx.organizationId,
      brandId,
      url: p.outputUrl,
      externalRef: `replicate:${p.model}`,
      metadata: { predictionId: p.id, model: p.model, provider: 'replicate' },
    });
    return ok({ status: 'READY', url: p.outputUrl, mediaId: media.id, mediaError: media.error, model: p.model });
  }
  if (p.status === 'failed' || p.status === 'canceled') {
    return ok({ status: 'FAILED', error: p.error ?? 'Génération échouée côté Replicate.' });
  }
  return ok({ status: 'PROCESSING' });
});
