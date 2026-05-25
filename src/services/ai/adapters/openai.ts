import { ExternalApiError } from '@/lib/errors';
import type { AIAdapter } from '../AIProviderService';
import type { TextGenerationInput, TextGenerationOutput } from '../types';

/**
 * OpenAI chat completions adapter. Activated when ENABLE_REAL_AI=true and OPENAI_API_KEY present.
 * Uses fetch (no SDK dep) to keep bundle small. Replace model id as needed.
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function buildMessages(input: TextGenerationInput) {
  const sys = input.systemPrompt ?? buildSystemPrompt(input);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: input.prompt },
  ];
}

function buildSystemPrompt(input: TextGenerationInput): string {
  const lines: string[] = [
    'Tu es un copywriter marketing expert multi-plateformes.',
    `Langue de sortie: ${input.language ?? 'fr'}.`,
  ];
  if (input.brandContext) {
    const bc = input.brandContext;
    lines.push(`Marque: ${bc.name}.`);
    if (bc.toneOfVoice) lines.push(`Ton: ${bc.toneOfVoice}.`);
    if (bc.audienceTarget) lines.push(`Audience: ${bc.audienceTarget}.`);
    if (bc.wordsToUse?.length) lines.push(`Mots à utiliser: ${bc.wordsToUse.join(', ')}.`);
    if (bc.wordsToAvoid?.length) lines.push(`Mots à éviter (interdits): ${bc.wordsToAvoid.join(', ')}.`);
  }
  if (input.platform) lines.push(`Plateforme cible: ${input.platform}.`);
  if (input.format) lines.push(`Format: ${input.format}.`);
  if (input.cta) lines.push(`Termine par un appel à l'action: "${input.cta}".`);
  return lines.join(' ');
}

export const openaiAdapter: AIAdapter = {
  name: 'openai',
  async generateText(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const start = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ExternalApiError('openai', 'OPENAI_API_KEY missing');

    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(input),
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 800,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('openai', `${res.status} ${txt}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    return {
      text,
      provider: 'openai',
      model,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      durationMs: Date.now() - start,
      mocked: false,
    };
  },
};
