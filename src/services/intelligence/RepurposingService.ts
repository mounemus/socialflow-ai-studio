/**
 * RepurposingService — 1 source post -> N platform-tailored variants.
 *
 * The biggest leverage in modern social: one long-form idea produces a week of content.
 * This service:
 *   1. takes a source post (or raw text/topic)
 *   2. generates platform-tailored variants (length, format, structure, hashtags, CTA)
 *   3. optionally persists each variant as a separate DRAFT post
 *
 * Targets: LinkedIn, Twitter, Instagram, TikTok, YouTube Short, Email, Reel script.
 */
import { AIRouterService } from '@/services/ai/AIRouterService';
import { BrandDNAService } from './BrandDNAService';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { SupportFormat } from '@prisma/client';

export type RepurposeTarget =
  | 'INSTAGRAM_POST' | 'INSTAGRAM_REEL' | 'INSTAGRAM_STORY' | 'INSTAGRAM_CAROUSEL'
  | 'LINKEDIN_POST' | 'LINKEDIN_ARTICLE'
  | 'TWITTER_POST' | 'TWITTER_THREAD'
  | 'TIKTOK_VIDEO' | 'YOUTUBE_SHORT'
  | 'EMAIL_MARKETING' | 'VIDEO_SCRIPT';

const TARGET_SPECS: Record<RepurposeTarget, { maxLen: number; tone: string; structure: string; hashtagCount: number }> = {
  INSTAGRAM_POST:     { maxLen: 2200, tone: 'visuel, émotionnel, narratif', structure: 'hook 1 ligne + corps 3-4 paragraphes courts + CTA', hashtagCount: 10 },
  INSTAGRAM_REEL:     { maxLen: 250,  tone: 'punchy, accroche immédiate', structure: 'caption courte pour vidéo verticale', hashtagCount: 8 },
  INSTAGRAM_STORY:    { maxLen: 100,  tone: 'spontané, conversationnel', structure: 'ultra court, 1-2 phrases', hashtagCount: 3 },
  INSTAGRAM_CAROUSEL: { maxLen: 2200, tone: 'didactique, slide-friendly', structure: 'slide 1 hook + slides 2-7 idées + slide 8 CTA', hashtagCount: 10 },
  LINKEDIN_POST:      { maxLen: 3000, tone: 'expertise, professionnel, narratif', structure: 'hook + story/insight + leçon + question CTA', hashtagCount: 5 },
  LINKEDIN_ARTICLE:   { maxLen: 8000, tone: 'long-form, autoritaire, structuré', structure: 'titre + intro + 3-5 sections H2 + conclusion + CTA', hashtagCount: 5 },
  TWITTER_POST:       { maxLen: 280,  tone: 'concis, punchline', structure: '1 idée forte en 1 tweet', hashtagCount: 2 },
  TWITTER_THREAD:     { maxLen: 3500, tone: 'narratif, fil', structure: 'tweet 1 hook + 5-10 tweets numérotés + tweet final CTA', hashtagCount: 2 },
  TIKTOK_VIDEO:       { maxLen: 150,  tone: 'hook 3 secondes + payoff', structure: 'caption + script vocal court', hashtagCount: 8 },
  YOUTUBE_SHORT:      { maxLen: 100,  tone: 'curiosité', structure: 'titre + description courte', hashtagCount: 5 },
  EMAIL_MARKETING:    { maxLen: 1500, tone: 'personnel, valeur d\'abord', structure: 'objet + intro + corps + CTA + PS', hashtagCount: 0 },
  VIDEO_SCRIPT:       { maxLen: 2000, tone: 'parlé, naturel', structure: 'hook + 3 beats + CTA — indique pauses et b-roll', hashtagCount: 0 },
};

function targetToFormat(target: RepurposeTarget): SupportFormat | null {
  // Cast — values map 1:1 to SupportFormat enum strings
  return target as SupportFormat;
}

function platformOf(target: RepurposeTarget): string {
  if (target.startsWith('INSTAGRAM')) return 'INSTAGRAM';
  if (target.startsWith('LINKEDIN')) return 'LINKEDIN';
  if (target.startsWith('TWITTER')) return 'TWITTER';
  if (target.startsWith('TIKTOK')) return 'TIKTOK';
  if (target.startsWith('YOUTUBE')) return 'YOUTUBE';
  if (target.startsWith('EMAIL')) return 'EMAIL';
  return 'GENERIC';
}

export interface RepurposeVariant {
  target: RepurposeTarget;
  platform: string;
  title?: string;
  body: string;
  hashtags: string[];
  cta?: string;
  notes?: string; // production notes (visuals, b-roll, timing)
  mocked: boolean;
}

export interface RepurposeInput {
  sourceText: string;
  sourceTitle?: string;
  brandId?: string | null;
  targets: RepurposeTarget[];
  language?: string;
  applyBrandDNA?: boolean;
}

export const RepurposingService = {
  async repurpose(input: RepurposeInput): Promise<RepurposeVariant[]> {
    const lang = input.language ?? 'fr';
    let brandFragment = '';
    if (input.applyBrandDNA && input.brandId) {
      const dna = await BrandDNAService.getStoredFor(input.brandId);
      if (dna) brandFragment = BrandDNAService.buildPromptFragment(dna);
    }

    const variants: RepurposeVariant[] = [];
    for (const target of input.targets) {
      const spec = TARGET_SPECS[target];
      const systemPrompt = `Tu repurpose un contenu source pour un format cible spécifique.

Format cible: ${target}
Plateforme: ${platformOf(target)}
Longueur max: ${spec.maxLen} caractères
Ton: ${spec.tone}
Structure: ${spec.structure}
Hashtags attendus: ${spec.hashtagCount}

Réponds STRICTEMENT en JSON:
{
  "title": "titre court — null si pas pertinent pour le format",
  "body": "le contenu adapté, respectant la structure et la longueur",
  "hashtags": ["#tag1", ...],
  "cta": "CTA explicite",
  "notes": "notes de production si vidéo (visuels, b-roll, timing). null sinon"
}

Règles:
- Adapte VRAIMENT au format — ne copie pas la source en la coupant
- Garde l'idée centrale, change la forme
- Respecte la voix de marque si fournie
- Langue: ${lang}

${brandFragment}`;

      const userPrompt = `=== SOURCE ===
${input.sourceTitle ? `Titre: ${input.sourceTitle}\n\n` : ''}${input.sourceText}

=== TÂCHE ===
Repurpose pour ${target}. Rends le JSON.`;

      try {
        // Route by format characteristic
        const task = target === 'TWITTER_POST' || target === 'INSTAGRAM_STORY'
          ? 'TEXT_SHORT_COPY'
          : target === 'LINKEDIN_ARTICLE'
            ? 'TEXT_LONGFORM'
            : target === 'VIDEO_SCRIPT' || target === 'TIKTOK_VIDEO' || target === 'INSTAGRAM_REEL' || target === 'YOUTUBE_SHORT'
              ? 'TEXT_REEL_SCRIPT'
              : target === 'EMAIL_MARKETING'
                ? 'TEXT_EMAIL'
                : 'TEXT_STRUCTURED_JSON';

        const result = await AIRouterService.generateTextForTask(task, {
          prompt: userPrompt,
          systemPrompt,
          maxTokens: Math.min(4000, Math.ceil(spec.maxLen * 1.5)),
          temperature: 0.75,
          language: lang,
        });
        const match = result.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Partial<RepurposeVariant>;
          variants.push({
            target,
            platform: platformOf(target),
            title: parsed.title ?? undefined,
            body: parsed.body ?? result.text.slice(0, spec.maxLen),
            hashtags: parsed.hashtags ?? [],
            cta: parsed.cta ?? undefined,
            notes: parsed.notes ?? undefined,
            mocked: result.mocked,
          });
        } else {
          // No JSON — use raw text
          variants.push({
            target, platform: platformOf(target),
            body: result.text.slice(0, spec.maxLen),
            hashtags: [], mocked: result.mocked,
          });
        }
      } catch (err) {
        logger.warn('Repurpose variant failed', { target, err: (err as Error).message });
        variants.push({
          target, platform: platformOf(target),
          body: `[mock] Adaptation de "${input.sourceTitle ?? 'la source'}" pour ${target}.`,
          hashtags: [], mocked: true,
        });
      }
    }
    return variants;
  },

  /**
   * Persist generated variants as DRAFT posts.
   */
  async persistAsDrafts(opts: {
    organizationId: string;
    brandId?: string | null;
    sourcePostId?: string;
    variants: RepurposeVariant[];
  }): Promise<string[]> {
    const ids: string[] = [];
    for (const v of opts.variants) {
      const format = targetToFormat(v.target);
      if (!format) continue;
      const post = await db.post.create({
        data: {
          organizationId: opts.organizationId,
          brandId: opts.brandId ?? null,
          status: 'DRAFT',
          format,
          title: v.title ?? null,
          body: v.body,
          hashtags: v.hashtags,
          cta: v.cta ?? null,
          metadata: {
            repurposedFrom: opts.sourcePostId ?? null,
            target: v.target,
            mocked: v.mocked,
          } as never,
        },
      });
      ids.push(post.id);
    }
    return ids;
  },
};
