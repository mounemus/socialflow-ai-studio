import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIModelPreferenceService } from '@/services/ai/AIModelPreferenceService';
import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';
import { replicateVideoAdapter, DEFAULT_VIDEO_MODEL } from '@/services/ai/adapters/replicate-video';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const postSchema = z.object({
  prompt: z.string().min(10).max(2000),
  brandId: z.string().optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
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

  if (!replicateVideoAdapter.isConfigured()) {
    return ok({
      available: false,
      reason: 'REPLICATE_API_TOKEN manquant — la génération vidéo est indisponible (aucune simulation).',
    });
  }

  // La vidéo coûte cher — garde-fou budgétaire de l'agent appliqué.
  const budget = await AgentGuardrailService.checkBudget(ctx.organizationId);
  if (!budget.allowed) {
    return ok({ available: false, reason: budget.reason });
  }

  const prefs = await AIModelPreferenceService.forOrg(ctx.organizationId);
  const model =
    prefs.VIDEO.mode === 'FORCED' && prefs.VIDEO.model ? prefs.VIDEO.model : DEFAULT_VIDEO_MODEL;

  const prediction = await replicateVideoAdapter.createPrediction({
    prompt: body.prompt,
    model,
    aspectRatio: body.aspectRatio,
  });

  await db.aIRequest
    .create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        type: 'VIDEO' as never,
        prompt: body.prompt,
        metadata: { provider: 'replicate', model, predictionId: prediction.id } as never,
      },
    })
    .catch(() => undefined);

  return ok({ available: true, predictionId: prediction.id, status: 'PROCESSING', model });
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
