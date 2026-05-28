/**
 * Stability AI image adapter — SDXL via REST API.
 * Docs: https://platform.stability.ai/docs/api-reference#tag/Generate
 */
import { ExternalApiError } from '@/lib/errors';
import type { ImageGenerationInput, ImageGenerationOutput } from '../types';

const ASPECT_RATIOS: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '4:5',
  '9:16': '9:16',
  '16:9': '16:9',
};

export const stabilityImageAdapter = {
  name: 'stability' as const,

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const key = process.env.STABILITY_API_KEY;
    if (!key) throw new ExternalApiError('stability', 'STABILITY_API_KEY missing');

    const prompt = input.styleHint
      ? `${input.prompt}, ${input.styleHint}`
      : input.prompt;
    const aspect = ASPECT_RATIOS[input.aspectRatio ?? '1:1'] ?? '1:1';

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('aspect_ratio', aspect);
    form.append('output_format', 'png');

    const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'image/*',
      },
      body: form,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('stability', `${res.status} ${txt.slice(0, 200)}`);
    }

    // Stability returns raw PNG bytes. We need to upload to storage or convert to data URL.
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    return {
      url: dataUrl,
      provider: 'stability',
      mocked: false,
    };
  },
};
