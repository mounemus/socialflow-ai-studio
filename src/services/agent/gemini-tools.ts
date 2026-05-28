/**
 * Gemini-powered agent tools — multimodal + long-context + grounded research.
 * These complement Claude's reasoning with Gemini's unique capabilities.
 */
import { db } from '@/lib/db';
import { GeminiService } from '@/services/ai/GeminiService';
import type { ToolDefinition } from './tools';

export const GEMINI_TOOLS: ToolDefinition[] = [
  {
    name: 'analyze_image',
    description:
      'Analyze an image using Gemini Vision. Modes: describe (general), alt_text (a11y), extract_text (OCR), brand_audit (vs brand kit). Returns structured findings.',
    input_schema: {
      type: 'object',
      required: ['imageUrl'],
      properties: {
        imageUrl: { type: 'string', description: 'Public HTTPS URL of the image' },
        mode: {
          type: 'string',
          enum: ['describe', 'alt_text', 'extract_text', 'brand_audit', 'custom'],
          default: 'describe',
        },
        brandId: { type: 'string', description: 'Required when mode=brand_audit' },
        customPrompt: { type: 'string', description: 'Required when mode=custom' },
      },
    },
    async run(input, ctx) {
      if (!GeminiService.isConfigured()) {
        return { error: 'Gemini not configured. Set GOOGLE_GEMINI_API_KEY in /admin/setup/gemini.' };
      }
      const mode = (input.mode as string) ?? 'describe';
      if (mode === 'brand_audit') {
        if (!input.brandId) return { error: 'brandId required for brand_audit' };
        const brand = await db.brand.findFirst({
          where: { id: input.brandId as string, organizationId: ctx.organizationId },
          include: { profile: true },
        });
        if (!brand) return { error: 'Brand not found' };
        return GeminiService.brandVisualAudit({
          brandName: brand.name,
          primaryColor: brand.profile?.primaryColor ?? undefined,
          visualStyle: brand.profile?.visualStyle ?? undefined,
          imageUrl: input.imageUrl as string,
        });
      }
      const prompts: Record<string, string> = {
        describe: 'Décris cette image en détail : sujet, composition, couleurs, mood. 2-3 phrases.',
        alt_text: 'Génère un alt-text accessible, max 125 caractères.',
        extract_text: 'Extrais tout le texte visible. Si rien, dis "Aucun texte détecté".',
      };
      const prompt = mode === 'custom'
        ? (input.customPrompt as string) ?? 'Décris cette image.'
        : prompts[mode] ?? prompts.describe;
      const result = await GeminiService.analyzeImage({
        imageUrl: input.imageUrl as string,
        prompt,
      });
      return { text: result.text };
    },
  },

  {
    name: 'daily_intelligence_brief',
    description:
      'Generate a strategic daily brief by analyzing ALL trends + competitor posts + recent published posts at once (Gemini long-context). Returns insights, opportunities, risks, suggested actions.',
    input_schema: {
      type: 'object',
      properties: {
        brandId: { type: 'string', description: 'Optional — defaults to first brand of org' },
      },
    },
    async run(input, ctx) {
      if (!GeminiService.isConfigured()) {
        return { error: 'Gemini not configured.' };
      }
      const brand = input.brandId
        ? await db.brand.findFirst({
            where: { id: input.brandId as string, organizationId: ctx.organizationId },
            include: { profile: true },
          })
        : await db.brand.findFirst({
            where: { organizationId: ctx.organizationId },
            include: { profile: true },
          });
      if (!brand) return { error: 'No brand found' };

      const [trendItems, competitorPosts, recentPosts] = await Promise.all([
        db.trendItem.findMany({
          where: { trendWatch: { organizationId: ctx.organizationId } },
          orderBy: [{ contentOpportunityScore: 'desc' }],
          take: 50,
        }),
        db.competitorPost.findMany({
          where: { competitor: { organizationId: ctx.organizationId } },
          orderBy: { postedAt: 'desc' },
          take: 30,
          include: { competitor: { select: { name: true } } },
        }),
        db.post.findMany({
          where: { organizationId: ctx.organizationId, brandId: brand.id, status: 'PUBLISHED' },
          orderBy: { updatedAt: 'desc' },
          take: 30,
          include: { analytics: true },
        }),
      ]);

      return GeminiService.dailyIntelligenceBrief({
        brandContext: {
          name: brand.name,
          industry: brand.industry,
          toneOfVoice: brand.profile?.toneOfVoice,
        },
        trendItems: trendItems.map((t) => ({
          title: t.title,
          summary: t.summary,
          url: t.url,
          score: t.contentOpportunityScore ?? undefined,
        })),
        competitorPosts: competitorPosts.map((p) => ({
          competitor: p.competitor.name,
          caption: p.caption ?? undefined,
          postedAt: p.postedAt,
        })),
        recentPosts: recentPosts.map((p) => ({
          title: p.title,
          body: p.body,
          impressions: p.analytics.reduce((s, a) => s + a.impressions, 0),
          engagement: p.analytics.reduce((s, a) => s + a.likes + a.comments + a.shares, 0),
        })),
      });
    },
  },

  {
    name: 'grounded_research',
    description:
      'Ask Gemini a question that requires real-time facts. Uses Google Search grounding. Returns answer + cited sources. Use this when the user asks about CURRENT events, prices, news, trends.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 5, maxLength: 500 },
      },
    },
    async run(input) {
      if (!GeminiService.isConfigured()) {
        return { error: 'Gemini not configured.' };
      }
      return GeminiService.groundedResearch({ query: input.query as string });
    },
  },

  {
    name: 'brand_visual_audit',
    description:
      'Audit a generated/uploaded image against a brand kit. Vision-powered scoring (overall + color match + style match) with concrete issues and suggestions.',
    input_schema: {
      type: 'object',
      required: ['imageUrl', 'brandId'],
      properties: {
        imageUrl: { type: 'string' },
        brandId: { type: 'string' },
      },
    },
    async run(input, ctx) {
      if (!GeminiService.isConfigured()) {
        return { error: 'Gemini not configured.' };
      }
      const brand = await db.brand.findFirst({
        where: { id: input.brandId as string, organizationId: ctx.organizationId },
        include: { profile: true },
      });
      if (!brand) return { error: 'Brand not found' };
      return GeminiService.brandVisualAudit({
        brandName: brand.name,
        primaryColor: brand.profile?.primaryColor ?? undefined,
        visualStyle: brand.profile?.visualStyle ?? undefined,
        imageUrl: input.imageUrl as string,
      });
    },
  },
];
