/**
 * Tools exposed to Claude agents. Each tool has:
 *  - schema (JSON schema for Claude tool definition)
 *  - run(input, ctx) -> implementation
 *
 * Tenant scope is ALWAYS enforced via ctx.organizationId — Claude can't see
 * cross-org data even if it tries.
 */
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';
import { CanvaService } from '@/services/canva/CanvaService';
import { MarketingWatchService } from '@/services/watch/MarketingWatchService';
import { CompetitorAnalysisService } from '@/services/competitor/CompetitorAnalysisService';
import type { TenantContext } from '@/lib/tenant';
import { MARKETING_TOOLS } from './marketing-tools';
import { GEMINI_TOOLS } from './gemini-tools';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, unknown>, ctx: TenantContext) => Promise<unknown>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'list_brands',
    description: 'List all brands of the current organization with their basic info.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      return db.brand.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true, industry: true, profile: { select: { toneOfVoice: true, audienceTarget: true } } },
      });
    },
  },
  {
    name: 'list_social_accounts',
    description: 'List connected social accounts (Instagram, Facebook, LinkedIn, etc.) with status and brand.',
    input_schema: {
      type: 'object',
      properties: {
        brandId: { type: 'string', description: 'optional - filter by brand' },
      },
    },
    async run(input, ctx) {
      return db.socialAccount.findMany({
        where: { organizationId: ctx.organizationId, ...(input.brandId ? { brandId: input.brandId as string } : {}) },
        select: { id: true, platform: true, type: true, handle: true, status: true, brand: { select: { name: true } } },
      });
    },
  },
  {
    name: 'generate_post',
    description:
      'Generate a single social post using AI. Returns the text + hashtags. Optionally saves as a draft Post. Use this when the user wants a post created.',
    input_schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'What to generate (brief)' },
        brandId: { type: 'string' },
        platform: { type: 'string', enum: ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'] },
        format: { type: 'string' },
        tone: { type: 'string' },
        language: { type: 'string', default: 'fr' },
        cta: { type: 'string' },
        saveAsDraft: { type: 'boolean', default: true },
      },
    },
    async run(input, ctx) {
      const brand = input.brandId
        ? await db.brand.findFirst({
            where: { id: input.brandId as string, organizationId: ctx.organizationId },
            include: { profile: true },
          })
        : null;
      const result = await AIProviderService.generateText({
        prompt: input.prompt as string,
        platform: input.platform as string | undefined,
        format: input.format as never,
        language: (input.language as string) ?? 'fr',
        tone: input.tone as string | undefined,
        cta: input.cta as string | undefined,
        brandContext: brand
          ? {
              name: brand.name,
              slogan: brand.profile?.slogan,
              mission: brand.profile?.mission,
              values: brand.profile?.values ?? [],
              audienceTarget: brand.profile?.audienceTarget,
              toneOfVoice: brand.profile?.toneOfVoice,
              officialHashtags: brand.profile?.officialHashtags ?? [],
              wordsToUse: brand.profile?.wordsToUse ?? [],
              wordsToAvoid: brand.profile?.wordsToAvoid ?? [],
            }
          : undefined,
      });

      let postId: string | undefined;
      if (input.saveAsDraft !== false) {
        const p = await db.post.create({
          data: {
            organizationId: ctx.organizationId,
            authorId: ctx.userId,
            brandId: brand?.id,
            status: 'AI_GENERATED',
            format: (input.format ?? 'INSTAGRAM_POST') as never,
            language: (input.language as string) ?? 'fr',
            body: result.text,
            hashtags: result.hashtags ?? [],
            cta: input.cta as string | undefined,
            aiPrompt: input.prompt as string,
            aiProvider: result.provider,
            aiModel: result.model,
          },
        });
        postId = p.id;
      }

      return { text: result.text, hashtags: result.hashtags, mocked: result.mocked, postId };
    },
  },
  {
    name: 'generate_calendar',
    description: 'Generate a content calendar (N days) for a brand across one or more platforms.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'daysCount'],
      properties: {
        brandId: { type: 'string' },
        daysCount: { type: 'number', minimum: 1, maximum: 31 },
        platforms: { type: 'array', items: { type: 'string' } },
        themes: { type: 'array', items: { type: 'string' } },
      },
    },
    async run(input, ctx) {
      const brand = await db.brand.findFirst({
        where: { id: input.brandId as string, organizationId: ctx.organizationId },
        include: { profile: true },
      });
      if (!brand) throw new Error('Brand not found');
      return AIProviderService.generateCalendar({
        brandContext: {
          name: brand.name,
          slogan: brand.profile?.slogan,
          mission: brand.profile?.mission,
          values: brand.profile?.values ?? [],
          audienceTarget: brand.profile?.audienceTarget,
          toneOfVoice: brand.profile?.toneOfVoice,
          officialHashtags: brand.profile?.officialHashtags ?? [],
        },
        daysCount: input.daysCount as number,
        platforms: (input.platforms as string[]) ?? ['INSTAGRAM'],
        themes: input.themes as string[] | undefined,
        language: 'fr',
      });
    },
  },
  {
    name: 'schedule_post',
    description: 'Schedule an existing post for publication on a social account.',
    input_schema: {
      type: 'object',
      required: ['postId', 'socialAccountId', 'scheduledFor'],
      properties: {
        postId: { type: 'string' },
        socialAccountId: { type: 'string' },
        scheduledFor: { type: 'string', description: 'ISO datetime' },
      },
    },
    async run(input, ctx) {
      const post = await db.post.findFirst({ where: { id: input.postId as string, organizationId: ctx.organizationId } });
      if (!post) throw new Error('Post not found');
      const schedule = await db.postSchedule.create({
        data: {
          postId: input.postId as string,
          socialAccountId: input.socialAccountId as string,
          scheduledFor: new Date(input.scheduledFor as string),
        },
      });
      await db.post.update({ where: { id: post.id }, data: { status: 'SCHEDULED' } });
      return { scheduleId: schedule.id, scheduledFor: schedule.scheduledFor };
    },
  },
  {
    name: 'generate_canva_brief',
    description: 'Generate a ready-to-paste Canva brief for a topic + brand.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'format', 'topic'],
      properties: {
        brandId: { type: 'string' },
        format: { type: 'string' },
        topic: { type: 'string' },
        cta: { type: 'string' },
      },
    },
    async run(input, ctx) {
      const brand = await db.brand.findFirst({
        where: { id: input.brandId as string, organizationId: ctx.organizationId },
        include: { profile: true },
      });
      if (!brand) throw new Error('Brand not found');
      return CanvaService.generateCanvaBrief({
        brandName: brand.name,
        format: input.format as string,
        topic: input.topic as string,
        cta: input.cta as string | undefined,
        tone: brand.profile?.toneOfVoice ?? undefined,
        audience: brand.profile?.audienceTarget ?? undefined,
        primaryColor: brand.profile?.primaryColor ?? undefined,
        visualStyle: brand.profile?.visualStyle ?? undefined,
      });
    },
  },
  {
    name: 'run_marketing_watch',
    description: 'Trigger an immediate refresh of all active marketing watches for the organization.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      return MarketingWatchService.runAllForOrg(ctx.organizationId);
    },
  },
  {
    name: 'list_recent_trends',
    description: 'Return the latest trend items collected by the watches, sorted by opportunity score.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 10 } },
    },
    async run(input, ctx) {
      const items = await db.trendItem.findMany({
        where: { trendWatch: { organizationId: ctx.organizationId } },
        orderBy: [{ contentOpportunityScore: 'desc' }, { createdAt: 'desc' }],
        take: (input.limit as number) ?? 10,
      });
      return items;
    },
  },
  {
    name: 'analyze_competitor',
    description: 'Run a SWOT analysis on a competitor.',
    input_schema: {
      type: 'object',
      required: ['competitorId'],
      properties: { competitorId: { type: 'string' } },
    },
    async run(input, ctx) {
      return CompetitorAnalysisService.analyze(input.competitorId as string, ctx.organizationId);
    },
  },
  {
    name: 'list_drafts',
    description: 'List recent post drafts (DRAFT or AI_GENERATED status).',
    input_schema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
    async run(input, ctx) {
      return db.post.findMany({
        where: { organizationId: ctx.organizationId, status: { in: ['DRAFT', 'AI_GENERATED'] } },
        orderBy: { updatedAt: 'desc' },
        take: (input.limit as number) ?? 20,
        select: { id: true, title: true, body: true, format: true, hashtags: true, brand: { select: { name: true } } },
      });
    },
  },
];

// Merge core tools + marketing/design + Gemini multimodal
export const ALL_TOOLS: ToolDefinition[] = [...TOOLS, ...MARKETING_TOOLS, ...GEMINI_TOOLS];

export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function toolsForClaude() {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
