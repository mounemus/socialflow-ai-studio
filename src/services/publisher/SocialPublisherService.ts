/**
 * SocialPublisherService — single entry point for all social publishing.
 * Per-platform adapters keep validation + API specifics isolated.
 *
 * SIMULATION MODE (default): adapters return { simulated: true } with NO external
 *   id and NO URL. The schedule/post are marked SIMULATED — never PUBLISHED.
 *   This exercises the pipeline (queue → worker → analytics) without lying.
 *
 * REAL MODE: set ENABLE_REAL_PUBLISHING=true AND connect accounts (OAuth tokens
 *   stored encrypted in SocialToken). Platforms without a real implementation
 *   fail with ACTION_REQUIRED instead of faking success.
 *   See docs/API_LIMITS.md for per-platform constraints.
 */
import type { PostStatus, SocialPlatform } from '@prisma/client';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { invalidate } from '@/lib/cache';
import { getQueue, QUEUE_NAMES } from '@/lib/queue';
import { facebookAdapter } from './adapters/facebook';
import { instagramAdapter } from './adapters/instagram';
import { linkedinAdapter } from './adapters/linkedin';
import { twitterAdapter } from './adapters/twitter';
import { tiktokAdapter } from './adapters/tiktok';
import { youtubeAdapter } from './adapters/youtube';
import { pinterestAdapter } from './adapters/pinterest';
import { isRealMode } from './adapters/_shared';
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

function scheduleStatusFor(result: PublishResult): PostStatus {
  if (result.success) return result.simulated ? 'SIMULATED' : 'PUBLISHED';
  if (
    result.errorCode === 'NOT_IMPLEMENTED' ||
    result.errorCode === 'NO_TOKEN' ||
    result.errorCode === 'TOKEN_EXPIRED' ||
    result.errorCode === 'MISSING_TARGET'
  ) {
    return 'ACTION_REQUIRED';
  }
  return 'FAILED';
}

/**
 * SIMULATED / ACTION_REQUIRED are recent enum additions. If the database
 * hasn't been pushed yet (prisma db push), writing them throws — degrade to
 * FAILED with an explicit message rather than crash or, worse, fake PUBLISHED.
 */
async function updateScheduleStatus(
  scheduleId: string,
  status: PostStatus,
  data: { publishedAt?: Date | null; externalPostId?: string | null; errorMessage?: string | null },
) {
  try {
    await db.postSchedule.update({ where: { id: scheduleId }, data: { status, ...data } });
    return status;
  } catch (err) {
    if (status === 'SIMULATED' || status === 'ACTION_REQUIRED') {
      logger.error('New PostStatus value rejected by DB — run `prisma db push`', {
        status,
        err: (err as Error).message,
      });
      await db.postSchedule.update({
        where: { id: scheduleId },
        data: {
          status: 'FAILED',
          ...data,
          errorMessage: `[${status}] ${data.errorMessage ?? ''} (DB non migrée: exécutez prisma db push)`.trim(),
        },
      });
      return 'FAILED' as PostStatus;
    }
    throw err;
  }
}

export const SocialPublisherService = {
  getAdapter(platform: SocialPlatform): PlatformAdapter {
    return adapters[platform];
  },

  /**
   * Decrypt the most recent stored token for an account.
   * Returns an error reason instead of a token when absent/expired.
   */
  async resolveAccessToken(
    socialAccountId: string,
  ): Promise<{ token: string | null; reason?: 'NO_TOKEN' | 'TOKEN_EXPIRED' }> {
    const stored = await db.socialToken.findFirst({
      where: { socialAccountId },
      orderBy: { createdAt: 'desc' },
    });
    if (!stored) return { token: null, reason: 'NO_TOKEN' };
    if (stored.expiresAt && stored.expiresAt < new Date()) {
      return { token: null, reason: 'TOKEN_EXPIRED' };
    }
    try {
      return { token: decrypt(stored.accessTokenEnc) };
    } catch (err) {
      logger.error('SocialToken decrypt failed', { socialAccountId, err: (err as Error).message });
      return { token: null, reason: 'NO_TOKEN' };
    }
  },

  /**
   * Enqueue a publish job. The worker (src/workers/index.ts) consumes it.
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
      include: { socialAccount: true, socialPage: true, post: true },
    });
    if (!schedule) {
      return { success: false, simulated: false, mocked: false, error: 'Schedule not found' };
    }
    if (!schedule.socialAccount) {
      return {
        success: false,
        simulated: false,
        mocked: false,
        error: 'Schedule has no connected social account (MANUAL share mode — cannot auto-publish)',
      };
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
      return {
        success: false,
        simulated: false,
        mocked: false,
        error: validation.reason,
        errorCode: 'VALIDATION',
      };
    }

    await db.postSchedule.update({
      where: { id: schedule.id },
      data: { status: 'PUBLISHING', attempts: { increment: 1 } },
    });

    // Resolve the token up-front in real mode so adapters stay DB-free.
    let accessToken: string | null = null;
    if (isRealMode() && adapter.supportsRealPublishing) {
      const resolved = await this.resolveAccessToken(schedule.socialAccount.id);
      accessToken = resolved.token;
      if (!accessToken) {
        const error =
          resolved.reason === 'TOKEN_EXPIRED'
            ? 'Jeton d’accès expiré — reconnectez le compte social.'
            : 'Aucun jeton d’accès stocké — connectez le compte social via OAuth.';
        const status = await updateScheduleStatus(schedule.id, 'ACTION_REQUIRED', {
          errorMessage: error,
        });
        logger.warn('publish blocked: no usable token', {
          scheduleId: schedule.id,
          platform: schedule.socialAccount.platform,
          status,
        });
        return { success: false, simulated: false, mocked: false, error, errorCode: resolved.reason };
      }
    }

    let result: PublishResult;
    try {
      result = await adapter.publish(input, {
        account: schedule.socialAccount,
        page: schedule.socialPage,
        accessToken,
      });
    } catch (err) {
      result = {
        success: false,
        simulated: false,
        mocked: false,
        error: (err as Error).message,
        errorCode: 'API_ERROR',
      };
    }

    const status = scheduleStatusFor(result);
    await updateScheduleStatus(schedule.id, status, {
      // publishedAt is reserved for REAL publications.
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      // externalPostId only ever holds a REAL platform id (adapters no longer synthesize any).
      externalPostId: result.externalPostId ?? null,
      errorMessage: result.error ?? null,
    });

    if (result.success) {
      await db.post
        .update({
          where: { id: schedule.postId },
          data: { status: result.simulated ? 'SIMULATED' : 'PUBLISHED' },
        })
        .catch(async (err) => {
          if (result.simulated) {
            logger.error('Post SIMULATED status rejected by DB — run `prisma db push`', {
              err: (err as Error).message,
            });
          } else {
            throw err;
          }
        });
      // A publish changes both the next-action snapshot (manual-share/pending
      // counts) and analytics (published count) for this org — drop the
      // advisory caches so the dashboard reflects it on next load.
      const orgId = schedule.post?.organizationId;
      if (orgId) {
        invalidate(`nextaction:${orgId}`);
        invalidate(`analytics:${orgId}`);
      }
    }
    logger.info('publish result', {
      scheduleId: schedule.id,
      platform: schedule.socialAccount.platform,
      status,
      simulated: result.simulated,
      externalPostId: result.externalPostId ?? null,
    });
    return result;
  },
};
