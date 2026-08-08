/**
 * FlowRunnerService — exécute un graphe de l'éditeur nodal.
 *
 * Principe : chaque nœud consomme les SORTIES de ses parents et publie les
 * siennes. Rien n'est implicite — c'est ce qui manquait au Studio, où un
 * onglet ignorait le travail de l'autre. L'ordre d'exécution est déduit du
 * graphe (tri topologique), pas d'un enchaînement codé en dur.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AIProviderService } from '@/services/ai/AIProviderService';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { GeminiService } from '@/services/ai/GeminiService';
import { falAdapter } from '@/services/ai/adapters/fal';
import { replicateVideoAdapter } from '@/services/ai/adapters/replicate-video';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';
import { sanitizeSocialText } from '@/lib/social-text';
import { platformFromFormat } from '@/lib/post-status';
import type { FlowGraph, FlowNode } from '@/lib/contracts/flow';

const PLATFORM_FORMAT: Record<string, string> = {
  LINKEDIN: 'LINKEDIN_POST',
  INSTAGRAM: 'INSTAGRAM_POST',
  FACEBOOK: 'FACEBOOK_POST',
  TWITTER: 'TWITTER_POST',
  TIKTOK: 'TIKTOK_VIDEO',
  YOUTUBE: 'YOUTUBE_SHORT',
  PINTEREST: 'PINTEREST_PIN',
};

export interface FlowRunLog {
  nodeId: string;
  kind: string;
  status: 'ok' | 'skipped' | 'failed';
  detail: string;
  ms: number;
}

export interface FlowRunResult {
  logs: FlowRunLog[];
  /** Sorties par nœud — réinjectées dans le graphe pour l'affichage. */
  outputs: Record<string, Record<string, unknown>>;
  postId: string | null;
}

/** Ordre d'exécution : tri topologique (Kahn), stable et sans cycle. */
function topoOrder(graph: FlowGraph): FlowNode[] {
  const indegree = new Map<string, number>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const n of graph.nodes) indegree.set(n.id, 0);
  for (const e of graph.edges) {
    if (byId.has(e.target)) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: FlowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) order.push(node);
    for (const e of graph.edges.filter((x) => x.source === id)) {
      const left = (indegree.get(e.target) ?? 0) - 1;
      indegree.set(e.target, left);
      if (left === 0) queue.push(e.target);
    }
  }
  // Un cycle laisserait des nœuds de côté : on les ignore plutôt que boucler.
  return order;
}

function parentsOf(graph: FlowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

/** Agrège les sorties des parents d'un nœud. */
function inputsFor(
  graph: FlowGraph,
  nodeId: string,
  outputs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const p of parentsOf(graph, nodeId)) Object.assign(merged, outputs[p] ?? {});
  return merged;
}

export const FlowRunnerService = {
  async run(opts: {
    graph: FlowGraph;
    organizationId: string;
    userId?: string | null;
  }): Promise<FlowRunResult> {
    const { graph, organizationId } = opts;
    const outputs: Record<string, Record<string, unknown>> = {};
    const logs: FlowRunLog[] = [];
    let postId: string | null = null;

    for (const node of topoOrder(graph)) {
      const started = Date.now();
      const data = (node.data ?? {}) as Record<string, unknown>;
      const input = inputsFor(graph, node.id, outputs);
      try {
        if (node.kind === 'brief') {
          const platform = String(data.platform ?? 'LINKEDIN').toUpperCase();
          outputs[node.id] = {
            brandId: data.brandId ?? null,
            platform,
            format: PLATFORM_FORMAT[platform] ?? 'LINKEDIN_POST',
            objective: String(data.objective ?? ''),
          };
          logs.push({ nodeId: node.id, kind: node.kind, status: 'ok', detail: `Cible ${platform}`, ms: Date.now() - started });
          continue;
        }

        if (node.kind === 'text') {
          const brandId = (input.brandId as string | null) ?? null;
          const platform = String(input.platform ?? 'LINKEDIN');
          const objective = String(input.objective ?? '');
          const instruction = String(data.instruction ?? '').trim();
          const prompt = [objective, instruction].filter(Boolean).join('\n') || 'Rédige une publication engageante pour cette marque.';

          let brandContext: Parameters<typeof AIProviderService.generateText>[0]['brandContext'] | undefined;
          if (brandId) {
            const brand = await db.brand.findFirst({
              where: { id: brandId, organizationId },
              include: { profile: true },
            });
            if (brand) {
              brandContext = {
                name: brand.name,
                industry: brand.industry ?? undefined,
                toneOfVoice: brand.profile?.toneOfVoice ?? undefined,
                audienceTarget: brand.profile?.audienceTarget ?? undefined,
                wordsToUse: brand.profile?.wordsToUse ?? undefined,
                wordsToAvoid: brand.profile?.wordsToAvoid ?? undefined,
              } as never;
            }
          }

          // Le fournisseur choisi sur le nœud est HONORÉ ('auto' = routeur libre).
          const textProvider = String(data.provider ?? 'auto');
          const res = await AIProviderService.generateText({
            prompt,
            platform,
            format: (input.format as never) ?? undefined,
            language: String(data.language ?? 'fr'),
            brandContext,
            ...(textProvider !== 'auto' ? { forceProvider: textProvider as never } : {}),
          });
          const text = sanitizeSocialText(res.text);
          outputs[node.id] = { ...input, text, hashtags: res.hashtags ?? [], cta: res.cta ?? null };
          logs.push({ nodeId: node.id, kind: node.kind, status: 'ok', detail: `${text.length} caractères (${res.provider})`, ms: Date.now() - started });
          continue;
        }

        if (node.kind === 'image') {
          const basePrompt = String(data.prompt ?? '').trim();
          const fromText = String(input.text ?? '').slice(0, 400);
          const prompt = basePrompt || `Illustration for this social post: ${fromText}`;
          const provider = String(data.provider ?? 'flux');
          const aspectRatio = String(data.aspectRatio ?? '1:1') as '1:1' | '4:5' | '9:16' | '16:9';

          let url = '';
          let usedProvider = provider;
          if (provider === 'gemini') {
            const g = await GeminiService.generateImage({ prompt, aspectRatio });
            url = g.url;
            usedProvider = 'gemini';
          } else {
            const FORCED: Record<string, 'fal' | 'dalle' | 'stability'> = {
              flux: 'fal',
              dalle: 'dalle',
              stability: 'stability',
            };
            const forced = FORCED[provider];
            const out = await AIRouterService.generateImageForTask(
              provider === 'dalle' ? 'IMAGE_AD_WITH_TEXT' : 'IMAGE_PHOTOREALISTIC',
              { prompt, aspectRatio, ...(forced ? { forceProvider: forced } : {}) } as never,
            );
            url = out.url;
            usedProvider = String(out.provider);
          }
          if (!url) throw new Error('Aucune image produite');

          // base64 → tentative d'upload ; sinon servi par /api/media/[id]/raw.
          if (url.startsWith('data:')) {
            const uploaded = await SupabaseStorageService.uploadDataUrl({
              organizationId,
              dataUrl: url,
              prefix: 'flow',
            });
            if (uploaded) url = uploaded;
          }

          const media = await db.mediaAsset.create({
            data: {
              organizationId,
              brandId: (input.brandId as string | null) ?? null,
              kind: 'IMAGE',
              url,
              source: 'ai',
              mimeType: 'image/png',
              altText: prompt.slice(0, 200),
              metadata: { prompt, provider: usedProvider, via: 'flow' } as never,
            },
          });

          outputs[node.id] = { ...input, imageUrl: url, mediaId: media.id };
          logs.push({ nodeId: node.id, kind: node.kind, status: 'ok', detail: `Visuel généré (${usedProvider})`, ms: Date.now() - started });
          continue;
        }

        if (node.kind === 'video') {
          const basePrompt = String(data.prompt ?? '').trim();
          const fromText = String(input.text ?? '').slice(0, 300);
          const prompt = basePrompt || `Short social video about: ${fromText}`;
          const aspectRatio = String(data.aspectRatio ?? '9:16');

          // Génération vidéo = asynchrone (plusieurs minutes). On DÉMARRE la
          // prédiction et on rend la main avec son identifiant : jamais de
          // fausse vidéo, jamais d'attente bloquante dans le graphe.
          let predictionId: string | null = null;
          let provider = '';
          if (falAdapter.isConfigured()) {
            const p = await falAdapter.createVideoPrediction({ prompt, aspectRatio });
            predictionId = `fal:${p.model}:${p.id}`;
            provider = 'fal';
          } else if (replicateVideoAdapter.isConfigured()) {
            const p = await replicateVideoAdapter.createPrediction({ prompt, aspectRatio });
            predictionId = p.id;
            provider = 'replicate';
          } else {
            throw new Error('Aucun fournisseur vidéo configuré (FAL_KEY / REPLICATE_API_TOKEN)');
          }

          outputs[node.id] = { ...input, videoPredictionId: predictionId, videoPrompt: prompt };
          logs.push({
            nodeId: node.id,
            kind: node.kind,
            status: 'ok',
            detail: `Vidéo lancée (${provider}) — rendu en cours`,
            ms: Date.now() - started,
          });
          continue;
        }

        if (node.kind === 'publication') {
          const text = String(input.text ?? '');
          if (!text) throw new Error('Aucun texte en entrée — connectez un nœud Texte.');
          const format = String(input.format ?? 'LINKEDIN_POST');
          const mediaId = (input.mediaId as string | undefined) ?? undefined;
          const imageUrl = (input.imageUrl as string | undefined) ?? undefined;

          const post = await db.post.create({
            data: {
              organizationId,
              authorId: opts.userId ?? undefined,
              brandId: (input.brandId as string | null) ?? undefined,
              format: format as never,
              status: (String(data.status ?? 'DRAFT') as never),
              title: text.split('\n')[0]?.slice(0, 80) || 'Publication',
              body: text,
              hashtags: (input.hashtags as string[] | undefined) ?? [],
              metadata: {
                via: 'flow',
                platform: platformFromFormat(format),
                ...(mediaId ? { coverMediaId: mediaId } : {}),
                ...(imageUrl && /^https?:\/\//i.test(imageUrl) ? { coverUrl: imageUrl } : {}),
              } as never,
              ...(mediaId ? { media: { connect: { id: mediaId } } } : {}),
            },
          });
          postId = post.id;
          outputs[node.id] = { ...input, postId: post.id };
          logs.push({ nodeId: node.id, kind: node.kind, status: 'ok', detail: 'Publication créée', ms: Date.now() - started });
          continue;
        }

        logs.push({ nodeId: node.id, kind: node.kind, status: 'skipped', detail: 'Type inconnu', ms: Date.now() - started });
      } catch (err) {
        const detail = (err as Error).message.slice(0, 200);
        logger.warn('Flow: nœud en échec', { nodeId: node.id, kind: node.kind, detail });
        logs.push({ nodeId: node.id, kind: node.kind, status: 'failed', detail, ms: Date.now() - started });
        // On continue : les nœuds aval sans entrée signaleront proprement.
      }
    }

    return { logs, outputs, postId };
  },
};
