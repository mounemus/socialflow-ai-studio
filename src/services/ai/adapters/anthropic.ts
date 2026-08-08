import { ExternalApiError } from '@/lib/errors';
import type { AIAdapter } from '../AIProviderService';
import type { TextGenerationInput, TextGenerationOutput } from '../types';
import { PLAIN_POST_OUTPUT_RULE } from '../types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Les générations récentes de Claude ont retiré les paramètres
 * d'échantillonnage : `temperature`, `top_p` et `top_k` renvoient une erreur
 * 400 sur Fable 5, Opus 4.8, Opus 4.7 et Sonnet 5. Ils restent acceptés sur
 * Opus 4.6, Sonnet 4.6, Haiku 4.5 et les modèles antérieurs.
 */
function acceptsTemperature(model: string): boolean {
  return !/(opus-4-[78]|sonnet-5|fable-5|mythos-5)/.test(model);
}

export const anthropicAdapter: AIAdapter = {
  name: 'anthropic',
  async generateText(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const start = Date.now();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ExternalApiError('anthropic', 'ANTHROPIC_API_KEY missing');

    const model = input.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? 800,
        system: input.systemPrompt ?? buildSystem(input),
        messages: [{ role: 'user', content: input.prompt }],
        // ⚠️ `temperature` est SUPPRIMÉ sur Claude Opus 4.8 / 4.7, Sonnet 5 et
        // Fable 5 : l'envoyer renvoie une erreur 400 et fait échouer tout
        // l'appel. Ces modèles étant sélectionnables au catalogue, on ne
        // transmet le paramètre qu'aux modèles qui l'acceptent encore
        // (Opus 4.6, Sonnet 4.6, Haiku 4.5 et antérieurs).
        ...(acceptsTemperature(model) ? { temperature: input.temperature ?? 0.7 } : {}),
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('anthropic', `${res.status} ${txt}`);
    }

    const data = (await res.json()) as {
      content: { type: string; text: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    return {
      text,
      provider: 'anthropic',
      model,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      durationMs: Date.now() - start,
      mocked: false,
    };
  },
};

function buildSystem(input: TextGenerationInput): string {
  const parts: string[] = ['You are an expert multi-platform marketing copywriter.'];
  if (input.brandContext) {
    parts.push(`Brand: ${input.brandContext.name}.`);
    if (input.brandContext.toneOfVoice) parts.push(`Tone: ${input.brandContext.toneOfVoice}.`);
  }
  if (input.language) parts.push(`Output language: ${input.language}.`);
  if (input.platform) parts.push(`Target platform: ${input.platform}.`);
  parts.push(PLAIN_POST_OUTPUT_RULE);
  return parts.join(' ');
}
