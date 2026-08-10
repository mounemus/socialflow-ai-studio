import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIModelPreferenceService } from '@/services/ai/AIModelPreferenceService';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';
import { replicateVideoAdapter, DEFAULT_VIDEO_MODEL } from '@/services/ai/adapters/replicate-video';
import { falAdapter, pickFalVideoModel } from '@/services/ai/adapters/fal';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const postSchema = z.object({
  prompt: z.string().min(10).max(2000),
  brandId: z.string().optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
  /** Langue du CONTENU (voix off, textes à l'écran). Français par défaut. */
  language: z.string().default('fr'),
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

  if (!replicateVideoAdapter.isConfigured() && !falAdapter.isConfigured()) {
    return ok({
      available: false,
      reason: 'REPLICATE_API_TOKEN et FAL_KEY manquants — la génération vidéo est indisponible (aucune simulation).',
    });
  }

  // La vidéo coûte cher — garde-fou budgétaire de l'agent appliqué.
  const budget = await AgentGuardrailService.checkBudget(ctx.organizationId);
  if (!budget.allowed) {
    return ok({ available: false, reason: budget.reason });
  }

  const prefs = await AIModelPreferenceService.forOrg(ctx.organizationId);
  const forced = prefs.VIDEO.mode === 'FORCED' ? prefs.VIDEO : null;

  const logRequest = (provider: string, model: string, predictionId: string) =>
    db.aIRequest
      .create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          type: 'VIDEO' as never,
          prompt: body.prompt,
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
    const model = forced && forced.provider !== 'fal' && forced.model ? forced.model : DEFAULT_VIDEO_MODEL;
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
  const chain: Array<{ name: string; configured: boolean; launch: () => Promise<{ predictionId: string; model: string }> }> =
    forced && forced.provider !== 'fal'
      ? [
          { name: 'replicate', configured: replicateVideoAdapter.isConfigured(), launch: launchReplicate },
          { name: 'fal', configured: falAdapter.isConfigured(), launch: launchFal },
        ]
      : [
          { name: 'fal', configured: falAdapter.isConfigured(), launch: launchFal },
          { name: 'replicate', configured: replicateVideoAdapter.isConfigured(), launch: launchReplicate },
        ];

  const failures: string[] = [];
  for (const p of chain) {
    if (!p.configured) continue;
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
export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) throw new Error('id requis');

  // Prédiction fal.ai — id encodé "fal:{model}:{requestId}".
  if (id.startsWith('fal:')) {
    const rest = id.slice(4);
    const sep = rest.lastIndexOf(':');
    const model = rest.slice(0, sep);
    const requestId = rest.slice(sep + 1);
    if (!model || !requestId) throw new Error('id fal invalide');
    const fp = await falAdapter.getVideoPrediction(requestId, model);
    if (fp.status === 'succeeded' && fp.outputUrl) {
      const media = await db.mediaAsset
        .create({
          data: {
            organizationId: ctx.organizationId,
            brandId: url.searchParams.get('brandId') ?? undefined,
            kind: 'VIDEO',
            url: fp.outputUrl,
            source: 'ai',
            externalRef: `fal:${fp.model}`,
            metadata: { predictionId: fp.id, model: fp.model, provider: 'fal' } as never,
          },
        })
        .catch(() => null);
      return ok({ status: 'READY', url: fp.outputUrl, mediaId: media?.id ?? null, model: fp.model });
    }
    if (fp.status === 'failed') {
      return ok({ status: 'FAILED', error: fp.error ?? 'Génération échouée côté fal.ai.' });
    }
    return ok({ status: 'PROCESSING' });
  }

  const p = await replicateVideoAdapter.getPrediction(id);
  if (p.status === 'succeeded' && p.outputUrl) {
    const media = await db.mediaAsset
      .create({
        data: {
          organizationId: ctx.organizationId,
          brandId: url.searchParams.get('brandId') ?? undefined,
          kind: 'VIDEO',
          url: p.outputUrl,
          source: 'ai',
          externalRef: `replicate:${p.model}`,
          metadata: { predictionId: p.id, model: p.model } as never,
        },
      })
      .catch(() => null);
    return ok({ status: 'READY', url: p.outputUrl, mediaId: media?.id ?? null, model: p.model });
  }
  if (p.status === 'failed' || p.status === 'canceled') {
    return ok({ status: 'FAILED', error: p.error ?? 'Génération échouée côté Replicate.' });
  }
  return ok({ status: 'PROCESSING' });
});
