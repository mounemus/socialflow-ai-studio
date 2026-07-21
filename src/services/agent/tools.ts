/**
 * Tools exposed to Claude agents. Each tool has:
 *  - schema (JSON schema for Claude tool definition)
 *  - run(input, ctx) -> implementation
 *
 * Tenant scope is ALWAYS enforced via ctx.organizationId — Claude can't see
 * cross-org data even if it tries.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
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

/**
 * Lazy-load BrandPipelineService at runtime. We avoid a static import so that
 * tsc doesn't error if the file isn't created yet (the service is being built
 * by a parallel workstream — this codepath becomes active as soon as the file
 * lands on disk).
 */
type PipelineSvc = {
  start?: (o: {
    organizationId: string;
    userId: string;
    seed: Record<string, unknown>;
    horizon: string;
    language: string;
  }) => Promise<{ runId: string }>;
  advance?: (
    id: string,
    orgId: string,
    userId: string
  ) => Promise<{ step: string; status: string; awaiting: 'admin' | null }>;
  get?: (id: string, orgId: string) => Promise<{ step: string; status: string } | null>;
  approveProfile?: (id: string, userId: string) => Promise<unknown>;
  approveStrategy?: (id: string, userId: string) => Promise<unknown>;
};
async function loadPipelineService(): Promise<PipelineSvc | null> {
  try {
    // Runtime-only path — assembled so TS doesn't statically resolve it.
    const seg = ['@', '/services/pipeline/BrandPipelineService'].join('');
    const mod = (await (Function('p', 'return import(p)') as (p: string) => Promise<unknown>)(seg)) as
      | { BrandPipelineService?: PipelineSvc }
      | null;
    return mod?.BrandPipelineService ?? null;
  } catch (err) {
    logger.warn('agent/tools: import dynamique BrandPipelineService échoué', {
      err: (err as Error).message,
    });
    return null;
  }
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
      'Generate a single social post using AI. Returns the text + hashtags. Optionally saves as a draft Post. Use this when the user wants a post created. ' +
      'brandId is REQUIRED unless the user explicitly wants brand-less generic content (then pass generic:true). NEVER pick a brand the user did not designate.',
    input_schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'What to generate (brief)' },
        brandId: { type: 'string', description: 'REQUIRED unless generic:true — the brand the USER designated (never guessed)' },
        generic: { type: 'boolean', description: 'true ONLY if the user explicitly wants content without any brand context' },
        platform: { type: 'string', enum: ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'] },
        format: { type: 'string' },
        tone: { type: 'string' },
        language: { type: 'string', default: 'fr' },
        cta: { type: 'string' },
        saveAsDraft: { type: 'boolean', default: true },
      },
    },
    async run(input, ctx) {
      // Garde-fou anti-devinette : sans marque désignée ni demande explicitement
      // générique, on refuse — le modèle doit confirmer la marque avec l'utilisateur.
      if (!input.brandId && input.generic !== true) {
        return {
          error:
            'brandId manquant. Ne choisis PAS une marque toi-même : utilise list_brands puis demande à ' +
            'l’utilisateur de confirmer la marque cible (ou passe generic:true si il veut un contenu sans marque).',
        };
      }
      const brand = input.brandId
        ? await db.brand.findFirst({
            where: { id: input.brandId as string, organizationId: ctx.organizationId },
            include: { profile: true },
          })
        : null;
      if (input.brandId && !brand) {
        return { error: `Marque ${input.brandId} introuvable dans cette organisation.` };
      }
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

  // -------------------------------------------------------------------------
  // BRAND ONBOARDING PIPELINE TOOLS
  // Drive the Brand onboarding state machine:
  //   CREATE_BRAND -> ENRICH_PROFILE -> VALIDATE_PROFILE (admin gate)
  //   -> GENERATE_STRATEGY -> VALIDATE_STRATEGY_ITEMS (admin gate)
  //   -> EXECUTE_ITEMS -> DONE
  // These tools talk to BrandPipelineService when available. They are written
  // defensively so they degrade gracefully if the model/migration isn't applied
  // yet (returns { available:false, hint } instead of throwing).
  // -------------------------------------------------------------------------
  {
    name: 'start_brand_pipeline',
    description:
      'Start a new Brand onboarding pipeline run. Creates the Brand (if needed), seeds the run with the user inputs and kicks off the ENRICH_PROFILE step. Returns the pipeline run id and current step. Use this when the user wants to create / onboard a new brand.',
    input_schema: {
      type: 'object',
      required: ['brandName'],
      properties: {
        brandName: { type: 'string', description: 'Display name for the new brand' },
        industry: { type: 'string', description: 'Industry / vertical hint (optional)' },
        description: { type: 'string', description: 'Short description of the brand (optional)' },
        website: { type: 'string', description: 'Brand website URL (optional)' },
        audienceHint: { type: 'string', description: 'Target audience hint (optional)' },
        horizon: { type: 'string', enum: ['30d', '90d', '12mo'], default: '90d' },
        language: { type: 'string', default: 'fr' },
      },
    },
    async run(input, ctx) {
      const brandName = (input.brandName as string | undefined)?.trim();
      if (!brandName) return { error: 'brandName is required' };

      const seed = {
        name: brandName,
        industry: (input.industry as string | undefined) ?? null,
        description: (input.description as string | undefined) ?? null,
        website: (input.website as string | undefined) ?? null,
        audienceHint: (input.audienceHint as string | undefined) ?? null,
      };
      const horizon = (input.horizon as string | undefined) ?? '90d';
      const language = (input.language as string | undefined) ?? 'fr';

      try {
        // Prefer the dedicated service if it exists (production path).
        const svc = await loadPipelineService();
        if (svc?.start) {
          const r = await svc.start({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            seed,
            horizon,
            language,
          });
          return { pipelineId: r.runId, step: 'CREATE_BRAND', status: 'RUNNING' };
        }
      } catch (e) {
        // fall through to direct DB path
      }

      // Direct-DB fallback (works as soon as the migration exists, even without service).
      const anyDb = db as unknown as { brandPipelineRun?: { create: (a: unknown) => Promise<{ id: string; step: string; status: string }> } };
      if (!anyDb.brandPipelineRun) {
        return {
          available: false,
          hint:
            'BrandPipelineRun model not migrated yet. Add the BrandPipelineRun schema and run `prisma migrate dev` to enable this tool.',
        };
      }
      try {
        const run = await anyDb.brandPipelineRun.create({
          data: {
            organizationId: ctx.organizationId,
            startedById: ctx.userId,
            horizon,
            language,
            seed,
            status: 'RUNNING',
            step: 'CREATE_BRAND',
          },
          select: { id: true, step: true, status: true },
        } as unknown as Parameters<NonNullable<typeof anyDb.brandPipelineRun>['create']>[0]);
        return { pipelineId: run.id, step: run.step, status: run.status };
      } catch (e) {
        return { error: 'Failed to start pipeline', detail: (e as Error).message };
      }
    },
  },
  {
    name: 'advance_pipeline',
    description:
      'Advance the pipeline to its next non-gated step. Triggers the next automated step (e.g. ENRICH_PROFILE -> propose all profile fields, GENERATE_STRATEGY -> create the strategy, EXECUTE_ITEMS -> schedule approved items). No-op if the pipeline is awaiting an admin gate.',
    input_schema: {
      type: 'object',
      required: ['pipelineId'],
      properties: {
        pipelineId: { type: 'string', description: 'BrandPipelineRun id' },
      },
    },
    async run(input, ctx) {
      const pipelineId = input.pipelineId as string;
      if (!pipelineId) return { error: 'pipelineId is required' };

      try {
        const svc = await loadPipelineService();
        if (svc?.advance) {
          const r = await svc.advance(pipelineId, ctx.organizationId, ctx.userId);
          return { pipelineId, ...r };
        }
      } catch (e) {
        return { error: 'advance failed', detail: (e as Error).message };
      }

      const anyDb = db as unknown as {
        brandPipelineRun?: { findFirst: (a: unknown) => Promise<{ id: string; step: string; status: string; organizationId: string } | null> };
      };
      if (!anyDb.brandPipelineRun) {
        return { available: false, hint: 'BrandPipelineRun model not migrated yet.' };
      }
      const run = await anyDb.brandPipelineRun.findFirst({
        where: { id: pipelineId, organizationId: ctx.organizationId },
        select: { id: true, step: true, status: true, organizationId: true },
      } as unknown as Parameters<NonNullable<typeof anyDb.brandPipelineRun>['findFirst']>[0]);
      if (!run) return { error: 'Pipeline not found' };
      return {
        pipelineId: run.id,
        step: run.step,
        status: run.status,
        awaiting: null,
        hint: 'BrandPipelineService not available — install service to actually advance.',
      };
    },
  },
  {
    name: 'list_pending_pipelines',
    description:
      'List Brand onboarding pipeline runs in the current organization that are awaiting an admin gate (status = AWAITING_ADMIN). Use this to surface what needs human validation.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20, minimum: 1, maximum: 100 },
      },
    },
    async run(input, ctx) {
      const anyDb = db as unknown as {
        brandPipelineRun?: {
          findMany: (
            a: unknown
          ) => Promise<
            Array<{
              id: string;
              step: string;
              status: string;
              brandId: string | null;
              updatedAt: Date;
              seed: unknown;
              adminNotes: string | null;
            }>
          >;
        };
      };
      if (!anyDb.brandPipelineRun) {
        return { available: false, hint: 'BrandPipelineRun model not migrated yet.', items: [] };
      }
      try {
        const items = await anyDb.brandPipelineRun.findMany({
          where: { organizationId: ctx.organizationId, status: 'AWAITING_ADMIN' },
          orderBy: { updatedAt: 'desc' },
          take: (input.limit as number) ?? 20,
          select: {
            id: true,
            step: true,
            status: true,
            brandId: true,
            updatedAt: true,
            seed: true,
            adminNotes: true,
          },
        } as unknown as Parameters<NonNullable<typeof anyDb.brandPipelineRun>['findMany']>[0]);
        return { count: items.length, items };
      } catch (e) {
        return { error: 'list failed', detail: (e as Error).message, items: [] };
      }
    },
  },
  {
    name: 'approve_pipeline_step',
    description:
      'Approve the current admin gate on a Brand onboarding pipeline (VALIDATE_PROFILE or VALIDATE_STRATEGY_ITEMS). Requires OWNER/ADMIN/SUPER_ADMIN role on the org. After approval, the pipeline auto-advances to the next step.',
    input_schema: {
      type: 'object',
      required: ['pipelineId'],
      properties: {
        pipelineId: { type: 'string' },
        stepName: {
          type: 'string',
          enum: ['VALIDATE_PROFILE', 'VALIDATE_STRATEGY_ITEMS'],
          description: 'Optional: which gate to approve. Defaults to the current step.',
        },
      },
    },
    async run(input, ctx) {
      const pipelineId = input.pipelineId as string;
      if (!pipelineId) return { error: 'pipelineId is required' };
      const allowedRoles = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
      if (!allowedRoles.has(ctx.role)) {
        return { error: 'forbidden', detail: `Role ${ctx.role} cannot approve pipeline gates.` };
      }

      try {
        const svc = await loadPipelineService();
        if (svc) {
          const current = svc.get
            ? await svc.get(pipelineId, ctx.organizationId)
            : null;
          if (!current) return { error: 'Pipeline not found' };
          const targetStep = (input.stepName as string | undefined) ?? current.step;
          if (targetStep === 'VALIDATE_PROFILE' && svc.approveProfile) {
            await svc.approveProfile(pipelineId, ctx.userId);
            return { pipelineId, approved: 'VALIDATE_PROFILE', next: 'GENERATE_STRATEGY' };
          }
          if (targetStep === 'VALIDATE_STRATEGY_ITEMS' && svc.approveStrategy) {
            await svc.approveStrategy(pipelineId, ctx.userId);
            return { pipelineId, approved: 'VALIDATE_STRATEGY_ITEMS', next: 'EXECUTE_ITEMS' };
          }
          return { error: `Step ${targetStep} is not an admin gate` };
        }
      } catch (e) {
        return { error: 'approve failed', detail: (e as Error).message };
      }
      return {
        available: false,
        hint: 'BrandPipelineService not available yet — install service to approve gates.',
      };
    },
  },
  {
    name: 'reject_pipeline_step',
    description:
      'Reject the current admin gate on a Brand onboarding pipeline with feedback. Logs the rejection reason into adminNotes and keeps the pipeline AWAITING_ADMIN until items/fields are regenerated and reapproved.',
    input_schema: {
      type: 'object',
      required: ['pipelineId', 'stepName', 'feedback'],
      properties: {
        pipelineId: { type: 'string' },
        stepName: {
          type: 'string',
          enum: ['VALIDATE_PROFILE', 'VALIDATE_STRATEGY_ITEMS'],
        },
        feedback: { type: 'string', description: 'Why the step is rejected — guides regeneration.' },
      },
    },
    async run(input, ctx) {
      const pipelineId = input.pipelineId as string;
      const stepName = input.stepName as string;
      const feedback = (input.feedback as string | undefined)?.trim();
      if (!pipelineId || !stepName) return { error: 'pipelineId and stepName are required' };
      if (!feedback) return { error: 'feedback is required' };
      const allowedRoles = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
      if (!allowedRoles.has(ctx.role)) {
        return { error: 'forbidden', detail: `Role ${ctx.role} cannot reject pipeline gates.` };
      }

      const anyDb = db as unknown as {
        brandPipelineRun?: {
          findFirst: (a: unknown) => Promise<{ id: string; adminNotes: string | null; step: string } | null>;
          update: (a: unknown) => Promise<{ id: string; step: string; status: string }>;
        };
      };
      if (!anyDb.brandPipelineRun) {
        return { available: false, hint: 'BrandPipelineRun model not migrated yet.' };
      }
      try {
        const run = await anyDb.brandPipelineRun.findFirst({
          where: { id: pipelineId, organizationId: ctx.organizationId },
          select: { id: true, adminNotes: true, step: true },
        } as unknown as Parameters<NonNullable<typeof anyDb.brandPipelineRun>['findFirst']>[0]);
        if (!run) return { error: 'Pipeline not found' };
        const stamp = new Date().toISOString();
        const merged = [run.adminNotes ?? '', `[${stamp}] ${stepName} rejected: ${feedback}`]
          .filter(Boolean)
          .join('\n');
        const updated = await anyDb.brandPipelineRun.update({
          where: { id: pipelineId },
          data: { adminNotes: merged, status: 'AWAITING_ADMIN' },
          select: { id: true, step: true, status: true },
        } as unknown as Parameters<NonNullable<typeof anyDb.brandPipelineRun>['update']>[0]);
        return {
          pipelineId: updated.id,
          rejected: stepName,
          step: updated.step,
          status: updated.status,
          feedback,
        };
      } catch (e) {
        return { error: 'reject failed', detail: (e as Error).message };
      }
    },
  },
  {
    name: 'get_pipeline_status',
    description:
      'Get full status of a Brand onboarding pipeline run: current step, status, brandId, strategyId, per-field validation states, per-item validation states, execution log, and recent trace events.',
    input_schema: {
      type: 'object',
      required: ['pipelineId'],
      properties: {
        pipelineId: { type: 'string' },
      },
    },
    async run(input, ctx) {
      const pipelineId = input.pipelineId as string;
      if (!pipelineId) return { error: 'pipelineId is required' };

      const anyDb = db as unknown as {
        brandPipelineRun?: {
          findFirst: (
            a: unknown
          ) => Promise<{
            id: string;
            step: string;
            status: string;
            brandId: string | null;
            strategyId: string | null;
            horizon: string;
            language: string;
            seed: unknown;
            fieldStates: unknown;
            itemStates: unknown;
            executionLog: unknown;
            trace: unknown;
            adminNotes: string | null;
            approvedProfileAt: Date | null;
            approvedStrategyAt: Date | null;
            completedAt: Date | null;
            failureReason: string | null;
            createdAt: Date;
            updatedAt: Date;
          } | null>;
        };
      };
      if (!anyDb.brandPipelineRun) {
        return { available: false, hint: 'BrandPipelineRun model not migrated yet.' };
      }
      try {
        const run = await anyDb.brandPipelineRun.findFirst({
          where: { id: pipelineId, organizationId: ctx.organizationId },
          select: {
            id: true,
            step: true,
            status: true,
            brandId: true,
            strategyId: true,
            horizon: true,
            language: true,
            seed: true,
            fieldStates: true,
            itemStates: true,
            executionLog: true,
            trace: true,
            adminNotes: true,
            approvedProfileAt: true,
            approvedStrategyAt: true,
            completedAt: true,
            failureReason: true,
            createdAt: true,
            updatedAt: true,
          },
        } as unknown as Parameters<NonNullable<typeof anyDb.brandPipelineRun>['findFirst']>[0]);
        if (!run) return { error: 'Pipeline not found' };

        // Trim trace to last 20 events so the model stays under context budget.
        const trace = Array.isArray(run.trace) ? (run.trace as unknown[]).slice(-20) : run.trace;
        return { ...run, trace };
      } catch (e) {
        return { error: 'status fetch failed', detail: (e as Error).message };
      }
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
