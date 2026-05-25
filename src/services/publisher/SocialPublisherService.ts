/**
 * SocialPublisherService — single entry point for all social publishing.
 * Per-platform adapters keep validation + API specifics isolated.
 *
 * MOCK MODE (default): all adapters return a synthetic external_post_id and a fake URL.
 *                       This lets the entire pipeline (queue → worker → analytics)
 *                       be exercised end-to-end without real API credentials.
 *
 * REAL MODE: set ENABLE_REAL_PUBLISHING=true AND configure platform OAuth env vars.
 *            See docs/API_LIMITS.md for per-platform constraints.
 */
import type { SocialPlatform } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getQueue, QUEUE_NAMES } from '@/lib/queue';
import { facebookAdapter } from './adapters/facebook';
import { instagramAdapter } from './adapters/instagram';
import { linkedinAdapter } from './adapters/linkedin';
import { twitterAdapter } from './adapters/twitter';
import { tiktokAdapter } from './adapters/tiktok';
import { youtubeAdapter } from './adapters/youtube';
import { pinterestAdapter } from './adapters/pinterest';
import type { PlatformAdapter, PublishInput, PublishResult } from './types';

const adapters: Record<SocialPlatform, PlatformAdapter> = {
  FACEBOOK: facebookAdapter,
  INSTAGRAM: instagramAdapter,
  LINKEDIN: linkedinAdapter,
  TWITTER: twitterAdapter,
  TIKTOK: tiktokAdapter,
  YOUTUBE: youtubeAdapter,
  PINTEREST: pinterestAdapter,
};

export const SocialPublisherService = {
  getAdapter(platform: SocialPlatform): PlatformAdapter {
    return adapters[platform];
  },

  /**
   * Enqueue a publish job. The worker (src/workers/publish.ts) consumes it.
   * If no Redis is available we still run synchronously so dev UX is smooth.
   */
  async enqueue(input: PublishInput, runAt?: Date): Promise<{ jobId: string | null }> {
    if (!process.env.REDIS_URL || process.env.REDIS_URL === 'mock') {
      logger.info('No REDIS_URL — running publish synchronously', { postId: input.postId });
      await this.publishNow(input);
      return { jobId: null };
    }
    const queue = getQueue(QUEUE_NAMES.publish);
    const job = await queue.add('publish', input, {
      delay: runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0,
      jobId: `publish:${input.scheduleId}`,
    });
    return { jobId: job.id ?? null };
  },

  /**
   * Run the publish synchronously (called by worker or dev fallback).
   */
  async publishNow(input: PublishInput): Promise<PublishResult> {
    const schedule = await db.postSchedule.findUnique({
      where: { id: input.scheduleId },
      include: { socialAccount: true, post: true },
    });
    if (!schedule) {
      return { success: false, error: 'Schedule not found', mocked: false };
    }

    const adapter = this.getAdapter(schedule.socialAccount.platform);
    const validation = adapter.validate(input);
    if (!validation.ok) {
      await db.postSchedule.update({
        where: { id: schedule.id },
        data: {
          status: 'FAILED',
          errorMessage: validation.reason,
          attempts: { increment: 1 },
        },
      });
      return { success: false, error: validation.reason, mocked: true };
    }

    await db.postSchedule.update({
      where: { id: schedule.id },
      data: { status: 'PUBLISHING', attempts: { increment: 1 } },
    });

    let result: PublishResult;
    try {
      result = await adapter.publish(input);
    } catch (err) {
      result = { success: false, error: (err as Error).message, mocked: false };
    }

    await db.postSchedule.update({
      where: { id: schedule.id },
      data: {
        status: result.success ? 'PUBLISHED' : 'FAILED',
        publishedAt: result.success ? new Date() : null,
        externalPostId: result.externalPostId,
        errorMessage: result.error,
      },
    });

    if (result.success) {
      await db.post.update({
        where: { id: schedule.postId },
        data: { status: 'PUBLISHED' },
      });
    }
    return result;
  },
};
