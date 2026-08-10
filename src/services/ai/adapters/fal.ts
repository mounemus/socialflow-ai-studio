/**
 * Adaptateur fal.ai — images (FLUX, Nano Banana hébergé) et vidéo (Kling,
 * Seedance…) via l'API queue officielle (queue.fal.run).
 *
 * Auth: `Authorization: Key ${FAL_KEY}`.
 * Flux: POST queue.fal.run/{model} → { request_id, status_url, response_url }
 *       puis polling status → COMPLETED → GET response.
 *
 * Images: polling interne court (FLUX schnell ≈ 1-3 s) pour rester compatible
 * avec l'interface synchrone du routeur. Vidéo: API asynchrone assumée
 * (create/get), aucun résultat simulé n'est jamais présenté comme réel.
 */
import { ExternalApiError } from '@/lib/errors';
import type { ImageGenerationInput, ImageGenerationOutput } from '../types';

const FAL_QUEUE = 'https://queue.fal.run';
export const DEFAULT_FAL_IMAGE_MODEL = 'fal-ai/flux/schnell';
export const DEFAULT_FAL_VIDEO_MODEL = 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video';

/**
 * Choix intelligent du modèle vidéo fal.ai selon le contexte du prompt.
 * Heuristique déterministe (aucun appel IA) :
 *  - besoin d'audio (voix off, musique, dialogue…) → Veo 3 Fast, seul à générer
 *    le son nativement ;
 *  - clip long / multi-séquences (30-45 s, script séquencé) → Seedance 2.5,
 *    natif jusqu'à ~30 s ;
 *  - brouillon / test / économique → Seedance 2.0 Fast ;
 *  - défaut (reel court soigné) → Kling 2.5 Turbo Pro (cinématique).
 */
export function pickFalVideoModel(prompt: string, _aspectRatio?: string): string {
  const p = prompt.toLowerCase();
  const wantsAudio = /(voix[- ]?off|voix\b|musique|audio|narration|dialogue|voice[- ]?over|music|parle|chanson)/.test(p);
  if (wantsAudio) return 'fal-ai/veo3/fast';
  const longClip =
    /(30\s?s|45\s?s|30 secondes|45 secondes|séquence|sequence|timelapse|étapes|storyboard)/.test(p) ||
    prompt.length > 500;
  // Id canonique constaté dans le dashboard fal (Requests → Endpoint).
  if (longClip) return 'fal-ai/seedance-2.5/text-to-video';
  const draft = /(brouillon|test|rapide|draft|économique|economique|cheap)/.test(p);
  if (draft) return 'bytedance/seedance-2.0/fast/text-to-video';
  return DEFAULT_FAL_VIDEO_MODEL;
}

/**
 * Choix intelligent du modèle image fal.ai selon la tâche du routeur :
 * texte lisible dans l'image (pubs, miniatures) → Nano Banana 2 ;
 * photoréalisme / illustration → FLUX Schnell (rapide, économique).
 */
export function pickFalImageModel(task?: string): string {
  if (task && /(WITH_TEXT|THUMBNAIL)/.test(task)) return 'fal-ai/nano-banana-2';
  return DEFAULT_FAL_IMAGE_MODEL;
}

function key(): string {
  const k = process.env.FAL_KEY;
  if (!k) throw new ExternalApiError('fal', 'FAL_KEY manquant');
  return k;
}

function headers(): Record<string, string> {
  return { Authorization: `Key ${key()}`, 'Content-Type': 'application/json' };
}

/** Un id fal ressemble à "fal-ai/flux/schnell" ou "bytedance/seedance-2.0/…". */
function isFalModelId(model?: string): model is string {
  if (!model || !model.includes('/')) return false;
  // Exclut les ids Replicate connus (black-forest-labs/…, stability-ai/…, wan-video/…).
  return !/^(black-forest-labs|stability-ai|wan-video|minimax|lightricks)\//.test(model);
}

interface QueueSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  detail?: unknown;
}

async function submit(model: string, input: Record<string, unknown>): Promise<Required<Pick<QueueSubmit, 'request_id' | 'status_url' | 'response_url'>>> {
  const res = await fetch(`${FAL_QUEUE}/${model}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as QueueSubmit;
  if (!res.ok || !json.request_id) {
    throw new ExternalApiError(
      'fal',
      `${model}: ${res.status} ${typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail ?? '')}`.trim(),
    );
  }
  // status_url/response_url sont renvoyés par fal (gèrent le sous-chemin du
  // modèle) — on les reconstruit seulement en dernier recours.
  const base = `${FAL_QUEUE}/${baseAppId(model)}/requests/${json.request_id}`;
  return {
    request_id: json.request_id,
    status_url: json.status_url ?? `${base}/status`,
    response_url: json.response_url ?? `${base}/response`,
  };
}

/** "fal-ai/kling-video/v2.5-turbo/pro/text-to-video" → "fal-ai/kling-video". */
export function baseAppId(model: string): string {
  return model.split('/').slice(0, 2).join('/');
}

function extractImageUrl(data: unknown): string | undefined {
  const d = data as { images?: Array<{ url?: string }>; image?: { url?: string } };
  return d?.images?.[0]?.url ?? d?.image?.url;
}

function extractVideoUrl(data: unknown): string | undefined {
  const d = data as { video?: { url?: string }; videos?: Array<{ url?: string }> };
  return d?.video?.url ?? d?.videos?.[0]?.url;
}

export const falAdapter = {
  isConfigured(): boolean {
    return !!process.env.FAL_KEY;
  },

  // ==========================================================================
  // IMAGE — synchrone du point de vue du routeur (polling interne ~25 s max)
  // ==========================================================================
  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const model = isFalModelId(input.model) ? input.model : DEFAULT_FAL_IMAGE_MODEL;
    const prompt = input.styleHint ? `${input.prompt}, ${input.styleHint}` : input.prompt;

    const body: Record<string, unknown> = { prompt };
    if (model.includes('flux')) {
      // Les endpoints FLUX utilisent image_size (enum), pas aspect_ratio.
      body.image_size =
        input.aspectRatio === '16:9' ? 'landscape_16_9'
        : input.aspectRatio === '9:16' ? 'portrait_16_9'
        : input.aspectRatio === '4:5' ? 'portrait_4_3'
        : 'square_hd';
    } else if (input.aspectRatio) {
      body.aspect_ratio = input.aspectRatio;
    }

    const q = await submit(model, body);
    const deadline = Date.now() + 25_000;
    for (;;) {
      const st = await fetch(q.status_url, { headers: { Authorization: `Key ${key()}` } });
      const sj = (await st.json().catch(() => ({}))) as { status?: string };
      if (sj.status === 'COMPLETED') break;
      if (Date.now() > deadline) {
        throw new ExternalApiError('fal', `${model}: délai dépassé (25 s) — requête ${q.request_id}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const rr = await fetch(q.response_url, { headers: { Authorization: `Key ${key()}` } });
    const data = (await rr.json().catch(() => ({}))) as unknown;
    const url = extractImageUrl(data);
    if (!rr.ok || !url) throw new ExternalApiError('fal', `${model}: réponse sans image (${rr.status})`);
    return { url, provider: 'fal' as never, mocked: false };
  },

  // ==========================================================================
  // VIDÉO — asynchrone (create → poll), même contrat que replicate-video
  // ==========================================================================
  async createVideoPrediction(opts: {
    prompt: string;
    model?: string;
    aspectRatio?: string;
  }): Promise<{ id: string; model: string }> {
    const model = isFalModelId(opts.model) ? opts.model : DEFAULT_FAL_VIDEO_MODEL;
    const body: Record<string, unknown> = { prompt: opts.prompt };
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    const q = await submit(model, body);
    return { id: q.request_id, model };
  },

  async getVideoPrediction(requestId: string, model: string): Promise<{
    id: string;
    status: 'processing' | 'succeeded' | 'failed';
    outputUrl?: string;
    error?: string;
    model: string;
  }> {
    // L'app id de polling n'est PAS toujours les 2 premiers segments du modèle :
    // certains ids (bytedance/seedance-2.5/…) répondent 405 sur la base courte.
    // On teste chaque base candidate (de la plus courte à la plus longue) et on
    // retient celle qui renvoie un vrai statut de file d'attente.
    // Les modèles édités par des tiers acceptent le submit sous leur namespace
    // (bytedance/…) mais leur file est servie sous fal-ai/… — on teste les deux.
    const idVariants = [model];
    const seg = model.split('/');
    if (seg[0] !== 'fal-ai') idVariants.push(['fal-ai', ...seg.slice(1)].join('/'));
    const bases: string[] = [];
    for (const v of idVariants) {
      const parts = v.split('/');
      for (let n = 2; n <= parts.length; n++) {
        const b = parts.slice(0, n).join('/');
        if (!bases.includes(b)) bases.push(b);
      }
    }

    const attempts: string[] = [];
    for (const appId of bases) {
      const base = `${FAL_QUEUE}/${appId}/requests/${encodeURIComponent(requestId)}`;
      const st = await fetch(`${base}/status`, { headers: { Authorization: `Key ${key()}` } });
      const sj = (await st.json().catch(() => ({}))) as { status?: string; error?: string };
      const queueStatus = sj.status ?? '';
      const isQueueAnswer = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(queueStatus);
      if (!st.ok || !isQueueAnswer) {
        attempts.push(`${appId} → ${st.status}${queueStatus ? ` (${queueStatus})` : ''}`);
        continue;
      }
      if (queueStatus !== 'COMPLETED') {
        return { id: requestId, status: 'processing', model };
      }
      const rr = await fetch(`${base}/response`, { headers: { Authorization: `Key ${key()}` } });
      const data = (await rr.json().catch(() => ({}))) as unknown;
      const url = extractVideoUrl(data);
      if (!rr.ok || !url) {
        return { id: requestId, status: 'failed', error: `fal: réponse sans vidéo (${rr.status})`, model };
      }
      return { id: requestId, status: 'succeeded', outputUrl: url, model };
    }
    return {
      id: requestId,
      status: 'failed',
      error: `fal: aucune base de polling valide — ${attempts.join(' · ')}`,
      model,
    };
  },
};
