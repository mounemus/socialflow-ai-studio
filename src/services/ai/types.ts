import type { SupportFormat } from '@prisma/client';

export type AIProviderName = 'openai' | 'anthropic' | 'gemini' | 'replicate' | 'stability' | 'canva' | 'mock';

export interface TextGenerationInput {
  prompt: string;
  systemPrompt?: string;
  /** Fournisseur imposé par la préférence org (claude|gpt|gemini) — sinon routage auto. */
  forceProvider?: string;
  /** Modèle précis imposé (ex: claude-haiku-4-5) — sinon défaut du fournisseur. */
  model?: string;
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
  /** Fournisseur imposé (replicate|dalle|stability|gemini) — sinon routage auto. */
  forceProvider?: string;
  /** Modèle précis imposé (ex: black-forest-labs/flux-dev, gpt-image-1). */
  model?: string;
  prompt: string;
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
  styleHint?: string;
  /** Optional brand context used by Canva (looks up CanvaTemplate by brandId). */
  brandId?: string;
  /** Optional org id forwarded to Canva when creating designs. */
  organizationId?: string;
  /** Optional structured variables forwarded to Canva brand templates. */
  canvaVariables?: {
    title?: string;
    body?: string;
    hashtags?: string[];
    image?: string;
    [key: string]: string | string[] | undefined;
  };
}

export interface ImageGenerationOutput {
  url: string;
  provider: AIProviderName;
  mocked: boolean;
  /** Set when the image was produced by Canva — id of the Canva design row. */
  canvaDesignId?: string;
  /** Set when the image was produced by Canva — Canva edit URL to open in a new tab. */
  editUrl?: string;
  /** How the Canva "design" was actually obtained — the UI must surface this. */
  canvaMode?: 'CANVA_API' | 'CANVA_HANDOFF' | 'MANUAL_FALLBACK';
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
