/**
 * Gemini text adapter for AIProviderService.
 * Use case: Gemini Flash for fast/cheap text generation when chosen as default text provider.
 */
import { ExternalApiError } from '@/lib/errors';
import type { AIAdapter } from '../AIProviderService';
import type { TextGenerationInput, TextGenerationOutput } from '../types';
import { GeminiService } from '../GeminiService';

function buildSystem(input: TextGenerationInput): string {
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
    if (bc.wordsToAvoid?.length) lines.push(`Mots à éviter: ${bc.wordsToAvoid.join(', ')}.`);
  }
  if (input.platform) lines.push(`Plateforme cible: ${input.platform}.`);
  if (input.cta) lines.push(`Termine par un CTA: "${input.cta}".`);
  return lines.join(' ');
}

export const geminiAdapter: AIAdapter = {
  name: 'gemini',
  async generateText(input: TextGenerationInput): Promise<TextGenerationOutput> {
    if (!GeminiService.isConfigured()) {
      throw new ExternalApiError('gemini', 'GOOGLE_GEMINI_API_KEY missing');
    }
    const start = Date.now();
    const result = await GeminiService.generateText({
      prompt: input.prompt,
      systemInstruction: input.systemPrompt ?? buildSystem(input),
      maxTokens: input.maxTokens,
      temperature: input.temperature,
    });
    return {
      text: result.text,
      provider: 'gemini',
      model: input.model ?? 'gemini-2.5-flash',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: Date.now() - start,
      mocked: false,
    };
  },
};
