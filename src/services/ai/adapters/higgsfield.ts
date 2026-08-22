/**
 * Adaptateur Higgsfield — vidéo texte→vidéo via l'API plateforme
 * (platform.higgsfield.ai), même contrat asynchrone que fal / replicate-video.
 *
 * Auth: `Authorization: Key ${HIGGSFIELD_API_KEY_ID}:${HIGGSFIELD_API_KEY_SECRET}`.
 * Flux: POST platform.higgsfield.ai/{model} → { request_id, status_url }
 *       puis GET /requests/{id}/status → completed → { video: { url } }.
 */
import { ExternalApiError } from '@/lib/errors';

const BASE = 'https://platform.higgsfield.ai';
export const DEFAULT_HIGGSFIELD_VIDEO_MODEL = 'bytedance/seedance/v1/pro/fast/text-to-video';

function headers() {
  const id = process.env.HIGGSFIELD_API_KEY_ID ?? '';
  const secret = process.env.HIGGSFIELD_API_KEY_SECRET ?? '';
  return { Authorization: `Key ${id}:${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

export const higgsfieldAdapter = {
  isConfigured(): boolean {
    return !!process.env.HIGGSFIELD_API_KEY_ID && !!process.env.HIGGSFIELD_API_KEY_SECRET;
  },

  async createVideoPrediction(opts: { prompt: string; model?: string; aspectRatio?: string; imageUrl?: string }): Promise<{ id: string; model: string }> {
    let model = (opts.model ?? DEFAULT_HIGGSFIELD_VIDEO_MODEL).replace(/^\/+/, '');
    if (opts.imageUrl) {
      // Endpoints image-to-video : même famille (seedance/kling/hailuo/sora/wan
      // existent tous en i2v), sinon Kling 2.1 Pro documenté.
      model = model.includes('text-to-video')
        ? model.replace('text-to-video', 'image-to-video')
        : 'kling-video/v2.1/pro/image-to-video';
    }
    const body: Record<string, unknown> = { prompt: opts.prompt };
    if (opts.imageUrl) body.image_url = opts.imageUrl;
    // aspect_ratio n'existe pas sur tous les modèles (Kling/Hailuo le déduisent
    // du prompt) — on ne l'envoie qu'aux endpoints qui le déclarent.
    if (opts.aspectRatio && /seedance|sora-2/.test(model)) body.aspect_ratio = opts.aspectRatio;
    const res = await fetch(`${BASE}/${model}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { request_id?: string; error?: string; detail?: unknown };
    if (!res.ok || !json.request_id) {
      throw new ExternalApiError('higgsfield', `${model}: ${res.status} ${JSON.stringify(json.error ?? json.detail ?? json).slice(0, 200)}`);
    }
    return { id: json.request_id, model };
  },

  async getVideoPrediction(requestId: string, model: string): Promise<{
    id: string;
    status: 'processing' | 'succeeded' | 'failed';
    outputUrl?: string;
    error?: string;
    model: string;
  }> {
    const res = await fetch(`${BASE}/requests/${encodeURIComponent(requestId)}/status`, { headers: headers() });
    const j = (await res.json().catch(() => ({}))) as { status?: string; error?: string | null; video?: { url?: string } };
    if (!res.ok) throw new ExternalApiError('higgsfield', `statut ${res.status} pour la requête ${requestId}`);
    if (j.status === 'completed') {
      const url = j.video?.url;
      if (!url) return { id: requestId, status: 'failed', error: 'Higgsfield : terminé sans URL vidéo.', model };
      return { id: requestId, status: 'succeeded', outputUrl: url, model };
    }
    if (j.status === 'failed' || j.status === 'canceled' || j.status === 'nsfw') {
      return { id: requestId, status: 'failed', error: j.error ?? `Higgsfield : ${j.status}`, model };
    }
    return { id: requestId, status: 'processing', model };
  },
};
