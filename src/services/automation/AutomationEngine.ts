/**
 * AutomationEngine — executes step-based workflows.
 * Steps are typed by AutomationActionType. Each step can use output of previous via {{step.N.<field>}} refs.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AIProviderService } from '../ai/AIProviderService';
import { CanvaService } from '../canva/CanvaService';
import { SocialPublisherService } from '../publisher/SocialPublisherService';
import type { AutomationActionType } from '@prisma/client';

export const AutomationEngine = {
  async runById(automationId: string, input: Record<string, unknown> = {}) {
    const auto = await db.automation.findUnique({
      where: { id: automationId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!auto) throw new Error('Automation not found');
    const run = await db.automationRun.create({
      data: { automationId, status: 'RUNNING', startedAt: new Date(), input: input as never },
    });

    const ctx: Record<string, unknown> = { input };
    try {
      for (const step of auto.steps) {
        ctx[`step_${step.order}`] = await this.executeStep(step.actionType, step.config as never, ctx, auto.organizationId, auto.brandId);
      }
      await db.automationRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), output: ctx as never },
      });
      return { ok: true, runId: run.id, output: ctx };
    } catch (err) {
      logger.error('Automation run failed', { automationId, err: (err as Error).message });
      await db.automationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: (err as Error).message },
      });
      return { ok: false, runId: run.id, error: (err as Error).message };
    }
  },

  async executeStep(
    type: AutomationActionType,
    config: Record<string, unknown>,
    ctx: Record<string, unknown>,
    organizationId: string,
    brandId: string | null,
  ): Promise<unknown> {
    switch (type) {
      case 'GENERATE_POST': {
        return AIProviderService.generateText({
          prompt: (config.prompt as string) ?? (ctx.input as { prompt?: string })?.prompt ?? 'Génère un post engageant',
          platform: config.platform as string | undefined,
          language: (config.language as string) ?? 'fr',
        });
      }
      case 'GENERATE_IMAGE': {
        return AIProviderService.generateImage({
          prompt: (config.prompt as string) ?? 'Visuel marketing',
        });
      }
      case 'GENERATE_CANVA_BRIEF': {
        return CanvaService.generateCanvaBrief({
          brandName: (config.brandName as string) ?? 'Marque',
          format: (config.format as string) ?? 'INSTAGRAM_POST',
          topic: (config.topic as string) ?? 'Sujet',
        });
      }
      case 'CREATE_DRAFT': {
        const post = await db.post.create({
          data: {
            organizationId,
            brandId: brandId ?? undefined,
            status: 'DRAFT',
            format: (config.format as never) ?? 'INSTAGRAM_POST',
            body: (config.body as string) ?? JSON.stringify(ctx),
          },
        });
        return { postId: post.id };
      }
      case 'SCHEDULE_POST': {
        const postId = (ctx.input as { postId?: string })?.postId ?? (config.postId as string | undefined);
        const socialAccountId = config.socialAccountId as string;
        if (!postId || !socialAccountId) throw new Error('SCHEDULE_POST requires postId + socialAccountId');
        const schedule = await db.postSchedule.create({
          data: {
            postId,
            socialAccountId,
            scheduledFor: new Date(config.scheduledFor as string),
          },
        });
        return { scheduleId: schedule.id };
      }
      case 'PUBLISH_POST': {
        const scheduleId = (ctx.input as { scheduleId?: string })?.scheduleId ?? (config.scheduleId as string | undefined);
        if (!scheduleId) throw new Error('PUBLISH_POST requires scheduleId');
        const schedule = await db.postSchedule.findUnique({
          where: { id: scheduleId },
          include: { post: true },
        });
        if (!schedule) throw new Error('Schedule not found');
        if (!schedule.socialAccountId) {
          throw new Error('Schedule has no connected social account (MANUAL share mode — cannot auto-publish)');
        }
        return SocialPublisherService.publishNow({
          postId: schedule.postId,
          scheduleId: schedule.id,
          socialAccountId: schedule.socialAccountId,
          body: schedule.post.body ?? '',
          hashtags: schedule.post.hashtags,
          mediaUrls: [],
        });
      }
      case 'TRANSLATE': {
        const text = (config.text as string) ?? '';
        const target = (config.targetLanguage as string) ?? 'en';
        return AIProviderService.translate(text, target);
      }
      case 'CREATE_AB_VARIANT':
      case 'SEND_NOTIFICATION':
      case 'CREATE_REPORT':
      case 'REQUEST_APPROVAL':
        // Mock no-op for MVP — clearly marked as future implementation.
        return { skipped: true, reason: `${type} not yet implemented` };
      default:
        throw new Error(`Unknown action: ${type}`);
    }
  },
};
