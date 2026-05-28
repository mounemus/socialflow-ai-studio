/**
 * Replicate image adapter — uses FLUX.1 [schnell] by default (fast + good quality + cheap).
 * Models: https://replicate.com/black-forest-labs/flux-schnell
 *
 * Replicate API is async (jobs) — we poll until done, max 60s.
 */
import { ExternalApiError } from '@/lib/errors';
import type { ImageGenerationInput, ImageGenerationOutput } from '../types';

const REPLICATE_API = 'https://api.replicate.com/v1';

const ASPECT_TO_DIM: Record<string, { width: number; height: number; aspect_ratio: string }> = {
  '1:1': { width: 1024, height: 1024, aspect_ratio: '1:1' },
  '4:5': { width: 832, height: 1024, aspect_ratio: '4:5' },
  '9:16': { width: 720, height: 1280, aspect_ratio: '9:16' },
  '16:9': { width: 1280, height: 720, aspect_ratio: '16:9' },
};

export const replicateImageAdapter = {
  name: 'replicate' as const,

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new ExternalApiError('replicate', 'REPLICATE_API_TOKEN missing');

    const model = process.env.REPLICATE_IMAGE_MODEL ?? 'black-forest-labs/flux-schnell';
    const aspect = ASPECT_TO_DIM[input.aspectRatio ?? '1:1'] ?? ASPECT_TO_DIM['1:1'];

    const prompt = input.styleHint
      ? `${input.prompt}, ${input.styleHint}`
      : input.prompt;

    // Create prediction
    const createRes = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=10', // Wait up to 10s synchronously
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: aspect.aspect_ratio,
          num_outputs: 1,
          output_format: 'png',
          output_quality: 90,
          go_fast: true,
        },
      }),
    });

    if (!createRes.ok) {
      const txt = await createRes.text();
      throw new ExternalApiError('replicate', `Create: ${createRes.status} ${txt.slice(0, 200)}`);
    }

    let prediction = (await createRes.json()) as {
      id: string;
      status: string;
      output?: string | string[];
      error?: string;
      urls?: { get?: string };
    };

    // Poll if not yet done
    const start = Date.now();
    const maxMs = 60_000;
    while ((prediction.status === 'starting' || prediction.status === 'processing') && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 1500));
      const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!pollRes.ok) {
        throw new ExternalApiError('replicate', `Poll ${pollRes.status}`);
      }
      prediction = await pollRes.json();
    }

    if (prediction.status !== 'succeeded') {
      throw new ExternalApiError('replicate', `Status: ${prediction.status} ${prediction.error ?? ''}`);
    }

    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!url) throw new ExternalApiError('replicate', 'No output URL');

    return {
      url,
      provider: 'replicate',
      mocked: false,
    };
  },
};
