import type { SupportFormat } from '@prisma/client';

export type AIProviderName = 'openai' | 'anthropic' | 'gemini' | 'replicate' | 'stability' | 'mock';

export interface TextGenerationInput {
  prompt: string;
  systemPrompt?: string;
  brandContext?: BrandContext;
  platform?: string;
  format?: SupportFormat;
  language?: string;
  tone?: string;
  audience?: string;
  maxTokens?: number;
  temperature?: number;
  cta?: string;
  hashtagsHint?: string[];
  wordsToAvoid?: string[];
  wordsToUse?: string[];
}

export interface TextGenerationOutput {
  text: string;
  hashtags?: string[];
  cta?: string;
  provider: AIProviderName;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  mocked: boolean;
}

export interface BrandContext {
  name: string;
  slogan?: string | null;
  mission?: string | null;
  values?: string[];
  audienceTarget?: string | null;
  toneOfVoice?: string | null;
  wordsToUse?: string[];
  wordsToAvoid?: string[];
  officialHashtags?: string[];
}

export interface ImageGenerationInput {
  prompt: string;
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
  styleHint?: string;
}

export interface ImageGenerationOutput {
  url: string;
  provider: AIProviderName;
  mocked: boolean;
}

export interface CalendarGenerationInput {
  brandContext: BrandContext;
  daysCount: number;
  platforms: string[];
  formats?: SupportFormat[];
  themes?: string[];
  language?: string;
}

export interface CalendarSuggestion {
  date: string;
  platform: string;
  format: SupportFormat;
  topic: string;
  body: string;
  hashtags: string[];
}
