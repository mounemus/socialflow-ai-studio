/**
 * AIProviderService — unified facade over multiple AI providers.
 * Routes to mock or real adapter based on env. All callers stay platform-agnostic.
 */
import { logger } from '@/lib/logger';
import { mockAdapter } from './adapters/mock';
import { openaiAdapter } from './adapters/openai';
import { anthropicAdapter } from './adapters/anthropic';
import { replicateImageAdapter } from './adapters/replicate-image';
import { stabilityImageAdapter } from './adapters/stability-image';
import type {
  AIProviderName,
  CalendarGenerationInput,
  CalendarSuggestion,
  ImageGenerationInput,
  ImageGenerationOutput,
  TextGenerationInput,
  TextGenerationOutput,
} from './types';

export interface AIAdapter {
  name: AIProviderName;
  generateText(input: TextGenerationInput): Promise<TextGenerationOutput>;
  generateImage?(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}

function pickTextAdapter(): AIAdapter {
  if (process.env.ENABLE_REAL_AI !== 'true') return mockAdapter;
  const pref = process.env.AI_DEFAULT_TEXT_PROVIDER ?? 'mock';
  if (pref === 'openai' && process.env.OPENAI_API_KEY) return openaiAdapter;
  if (pref === 'anthropic' && process.env.ANTHROPIC_API_KEY) return anthropicAdapter;
  return mockAdapter;
}

interface ImageAdapter {
  name: string;
  generateImage: (input: ImageGenerationInput) => Promise<ImageGenerationOutput>;
}

function pickImageAdapter(): ImageAdapter {
  if (process.env.ENABLE_REAL_AI !== 'true') {
    return { name: 'mock', generateImage: mockAdapter.generateImage! };
  }
  const pref = process.env.AI_DEFAULT_IMAGE_PROVIDER ?? 'replicate';
  if (pref === 'replicate' && process.env.REPLICATE_API_TOKEN) return replicateImageAdapter;
  if (pref === 'stability' && process.env.STABILITY_API_KEY) return stabilityImageAdapter;
  // Auto-fallback
  if (process.env.REPLICATE_API_TOKEN) return replicateImageAdapter;
  if (process.env.STABILITY_API_KEY) return stabilityImageAdapter;
  return { name: 'mock', generateImage: mockAdapter.generateImage! };
}

export const AIProviderService = {
  async generateText(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const adapter = pickTextAdapter();
    logger.info('AI.generateText', { provider: adapter.name, format: input.format });
    return adapter.generateText(input);
  },

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const adapter = pickImageAdapter();
    logger.info('AI.generateImage', { provider: adapter.name, aspectRatio: input.aspectRatio });
    return adapter.generateImage(input);
  },

  async generateHashtags(topic: string, brandHashtags: string[] = [], language = 'fr'): Promise<string[]> {
    const adapter = pickTextAdapter();
    const out = await adapter.generateText({
      prompt: `Génère 10 hashtags pertinents pour le sujet: "${topic}". Langue: ${language}. Inclure si pertinent: ${brandHashtags.join(', ')}.`,
      language,
      maxTokens: 200,
    });
    const matches = out.text.match(/#[A-Za-z0-9_éèêàâîôûç]+/g) ?? [];
    return [...new Set([...brandHashtags, ...matches])].slice(0, 15);
  },

  async generateCalendar(input: CalendarGenerationInput): Promise<CalendarSuggestion[]> {
    const adapter = pickTextAdapter();
    const suggestions: CalendarSuggestion[] = [];
    const now = Date.now();
    for (let i = 0; i < input.daysCount; i++) {
      const platform = input.platforms[i % input.platforms.length] ?? 'INSTAGRAM';
      const format = input.formats?.[i % input.formats.length] ?? 'INSTAGRAM_POST';
      const date = new Date(now + i * 86_400_000).toISOString().slice(0, 10);
      const topic = input.themes?.[i % (input.themes.length || 1)] ?? `Idée jour ${i + 1}`;

      const gen = await adapter.generateText({
        prompt: `Crée un post court (max 120 mots) pour ${platform} format ${format} sur le thème "${topic}".`,
        brandContext: input.brandContext,
        platform,
        format: format as never,
        language: input.language ?? 'fr',
        maxTokens: 400,
      });

      suggestions.push({
        date,
        platform,
        format: format as never,
        topic,
        body: gen.text,
        hashtags: (input.brandContext.officialHashtags ?? []).slice(0, 5),
      });
    }
    return suggestions;
  },

  async rewrite(text: string, instruction: string, language = 'fr'): Promise<string> {
    const adapter = pickTextAdapter();
    const out = await adapter.generateText({
      prompt: `Réécris ce texte selon l'instruction "${instruction}". Texte original:\n\n${text}`,
      language,
      maxTokens: 600,
    });
    return out.text;
  },

  async translate(text: string, targetLanguage: string): Promise<string> {
    const adapter = pickTextAdapter();
    const out = await adapter.generateText({
      prompt: `Traduis ce texte en ${targetLanguage} en conservant ton et style:\n\n${text}`,
      maxTokens: 800,
    });
    return out.text;
  },

  async analyzeTrends(items: { title: string; summary?: string }[]): Promise<string> {
    const adapter = pickTextAdapter();
    const out = await adapter.generateText({
      prompt: `Analyse ces tendances et propose 5 angles de contenu différenciants:\n${items
        .map((i, n) => `${n + 1}. ${i.title} — ${i.summary ?? ''}`)
        .join('\n')}`,
      maxTokens: 800,
    });
    return out.text;
  },

  async analyzeCompetitor(info: { name: string; posts: string[] }): Promise<{
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
    recommendations: string[];
  }> {
    const adapter = pickTextAdapter();
    const out = await adapter.generateText({
      prompt: `Analyse concurrentielle SWOT pour ${info.name} basée sur ces posts:\n${info.posts.join('\n\n')}\n\nRéponds en JSON avec strengths, weaknesses, opportunities, threats, recommendations (arrays de strings).`,
      maxTokens: 1000,
    });
    try {
      const match = out.text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : emptySwot();
    } catch {
      return emptySwot();
    }
  },
};

function emptySwot() {
  return {
    strengths: ['Présence cohérente', 'Branding lisible'],
    weaknesses: ['Manque de vidéo', 'Engagement bas en story'],
    opportunities: ['Format Reels', 'UGC client'],
    threats: ['Saturation marché', 'Algorithme évolutif'],
    recommendations: ['Tester Reels hebdomadaires', 'Carrousel éducatif récurrent'],
  };
}
