import type { AIAdapter } from '../AIProviderService';
import type { ImageGenerationInput, ImageGenerationOutput, TextGenerationInput, TextGenerationOutput } from '../types';

const SAMPLE_HASHTAGS = ['#marketing', '#contenu', '#digital', '#brand', '#growth', '#socialmedia', '#community', '#inspiration'];

export const mockAdapter: AIAdapter = {
  name: 'mock',
  async generateText(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const start = Date.now();
    const brand = input.brandContext?.name ?? 'votre marque';
    const tone = input.tone ?? input.brandContext?.toneOfVoice ?? 'inspirant';
    const lang = input.language ?? 'fr';

    const intro = lang === 'fr'
      ? `[MOCK ${tone}] Voici une proposition pour ${brand}.`
      : `[MOCK ${tone}] Here is a proposal for ${brand}.`;

    const body = `${intro}\n\nSujet : ${input.prompt.slice(0, 140)}\n\nValeur clé : ${input.brandContext?.mission ?? 'apporter de la valeur à votre audience'}.\n\n${input.cta ?? '👉 Découvrez-en plus en lien.'}`;

    const hashtags = [
      ...(input.brandContext?.officialHashtags ?? []),
      ...(input.hashtagsHint ?? []),
      ...SAMPLE_HASHTAGS,
    ].slice(0, 10);

    return {
      text: `${body}\n\n${hashtags.join(' ')}`,
      hashtags,
      cta: input.cta,
      provider: 'mock',
      model: 'mock-v1',
      inputTokens: input.prompt.length / 4,
      outputTokens: body.length / 4,
      durationMs: Date.now() - start,
      mocked: true,
    };
  },

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    // Returns a placeholder image URL — caller can swap with real provider later.
    const seed = encodeURIComponent(input.prompt.slice(0, 40));
    return {
      url: `https://picsum.photos/seed/${seed}/1024/1024`,
      provider: 'mock',
      mocked: true,
    };
  },
};
