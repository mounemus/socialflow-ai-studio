/**
 * Adaptateur vidéo Replicate — texte → vidéo courte (Wan, Hailuo, LTX…).
 *
 * Les jobs durent plusieurs minutes : API asynchrone assumée —
 * createPrediction() rend la main immédiatement, getPrediction() pour le
 * polling. AUCUNE vidéo simulée n'est jamais présentée comme réelle.
 */
import { ExternalApiError } from '@/lib/errors';

const REPLICATE_API = 'https://api.replicate.com/v1';
export const DEFAULT_VIDEO_MODEL = 'wan-video/wan-2.2-t2v-fast';

export interface VideoPrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  outputUrl?: string;
  error?: string;
  model: string;
}

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new ExternalApiError('replicate', 'REPLICATE_API_TOKEN manquant');
  return t;
}

export const replicateVideoAdapter = {
  isConfigured(): boolean {
    return !!process.env.REPLICATE_API_TOKEN;
  },

  async createPrediction(opts: {
    prompt: string;
    model?: string;
    aspectRatio?: string;
  }): Promise<VideoPrediction> {
    const model = opts.model && opts.model.includes('/') ? opts.model : DEFAULT_VIDEO_MODEL;
    const res = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: opts.prompt,
          ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      detail?: string;
      title?: string;
    };
    if (!res.ok || !json.id) {
      throw new ExternalApiError(
        'replicate',
        `Vidéo: ${res.status} ${json.title ?? ''} ${json.detail ?? ''}`.trim(),
      );
    }
    return { id: json.id, status: (json.status as VideoPrediction['status']) ?? 'starting', model };
  },

  async getPrediction(id: string): Promise<VideoPrediction> {
    const res = await fetch(`${REPLICATE_API}/predictions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: VideoPrediction['status'];
      output?: string | string[];
      error?: string;
      model?: string;
    };
    if (!res.ok || !json.id) throw new ExternalApiError('replicate', `Vidéo: lecture ${res.status}`);
    const outputUrl = Array.isArray(json.output) ? json.output[0] : json.output;
    return {
      id: json.id,
      status: json.status ?? 'processing',
      outputUrl: typeof outputUrl === 'string' ? outputUrl : undefined,
      error: json.error,
      model: json.model ?? 'replicate',
    };
  },
};
