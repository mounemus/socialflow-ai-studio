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
import crypto from 'node:crypto';
import type { Post, PostSchedule, PostStatus, SocialPlatform } from '@prisma/client';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { closePendingApprovals } from '@/lib/post-lifecycle';
import { invalidate } from '@/lib/cache';
import { getQueue, QUEUE_NAMES } from '@/lib/queue';
import { platformAdapters as adapters } from './adapters';
import { isRealMode } from './adapters/_shared';
import { SocialGatewayService } from '@/services/gateway/SocialGatewayService';
import type { GatewayPublishResult } from '@/services/gateway/types';
import type { PlatformAdapter, PublishInput, PublishResult } from './types';
import { publishableMediaUrls } from '@/lib/post-media';
import { sanitizeSocialText } from '@/lib/social-text';

/**
 * Reconstruit le PublishInput d'un schedule EXISTANT (cron de rattrapage, retry
 * manuel) — même construction que /api/posts/[id]/schedule, factorisée pour ne
 * pas la dupliquer à chaque appelant.
 */
export async function buildPublishInputFromSchedule(
  schedule: PostSchedule & { post: Post },
): Promise<PublishInput> {
  if (!schedule.socialAccountId) {
    throw new Error('Schedule has no socialAccountId — manual share mode, cannot auto-publish');
  }
  return {
    postId: schedule.postId,
    scheduleId: schedule.id,
    socialAccountId: schedule.socialAccountId,
    socialPageId: schedule.socialPageId ?? undefined,
    body: sanitizeSocialText(schedule.post.body ?? ''),
    hashtags: schedule.post.hashtags,
    mediaUrls: await publishableMediaUrls(schedule.post),
    cta: schedule.post.cta ?? undefined,
    linkUrl: schedule.post.linkUrl ?? undefined,
    scheduledFor: schedule.scheduledFor,
  };
}

function scheduleStatusFor(result: PublishResult & { verified?: boolean }): PostStatus {
  if (result.success) {
    if (result.simulated) return 'SIMULATED';
    // Vérité opérationnelle: un succès natif NON vérifié par relecture de
    // l'identifiant externe n'est pas déclaré PUBLISHED aveuglément.
    if (result.verified === false) return 'ACTION_REQUIRED';
    return 'PUBLISHED';
  }
  if (result.errorCode === 'PENDING') return 'PROCESSING';
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

const RECENT_ENUM_VALUES: PostStatus[] = [
  'SIMULATED',
  'ACTION_REQUIRED',
  'QUEUED',
  'UPLOADING',
  'PROCESSING',
  'MANUAL_SHARE_REQUIRED',
];

/**
 * The statuses above are recent enum additions. If the database hasn't been
 * pushed yet (prisma db push), writing them throws — degrade to FAILED with an
 * explicit message rather than crash or, worse, fake PUBLISHED.
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
    if (RECENT_ENUM_VALUES.includes(status)) {
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
      // Créneau FUTUR sans Redis : on ne publie surtout pas maintenant — le
      // schedule reste SCHEDULED et le cron publish-due (toutes les 5 min) le
      // publiera à l'heure due. Avant, « Programmer demain 10h » publiait
      // IMMÉDIATEMENT. Le seuil de 90 s couvre « publier maintenant » et les
      // créneaux passés sans re-déclencher pour de vrais différés.
      const delayMs = runAt ? runAt.getTime() - Date.now() : 0;
      if (delayMs > 90_000) {
        logger.info('No REDIS_URL — créneau futur laissé au cron publish-due', {
          postId: input.postId,
          scheduleId: input.scheduleId,
          runAt: runAt?.toISOString(),
        });
        return { jobId: null };
      }
      logger.info('No REDIS_URL — running publish synchronously', { postId: input.postId });
      await this.publishNow(input);
      return { jobId: null };
    }
    const queue = getQueue(QUEUE_NAMES.publish);
    const job = await queue.add('publish', input, {
      delay: runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0,
      jobId: `publish:${input.scheduleId}`,
    });
    await db.postSchedule
      .update({ where: { id: input.scheduleId }, data: { status: 'QUEUED' } })
      .catch((err) =>
        logger.warn('QUEUED status not persisted (DB pas encore migrée ?)', {
          scheduleId: input.scheduleId,
          err: (err as Error).message,
        }),
      );
    return { jobId: job.id ?? null };
  },

  /**
   * Run the publish synchronously (called by worker or dev fallback).
   */
  async publishNow(
    input: PublishInput,
    opts?: {
      /**
       * `true` uniquement quand l'appelant vient de RÉSERVER le créneau par un
       * updateMany conditionnel (cron publish-due). Autorise à traverser la
       * garde anti-replay PUBLISHING/PROCESSING ci-dessous.
       */
      claimedByCaller?: boolean;
    },
  ): Promise<PublishResult> {
    const requestId = crypto.randomUUID();
    const schedule = await db.postSchedule.findUnique({
      where: { id: input.scheduleId },
      include: { socialAccount: true, socialPage: true, post: true },
    });
    if (!schedule) {
      return { success: false, simulated: false, mocked: false, error: 'Schedule not found' };
    }

    // Idempotence : un schedule déjà publié pour de vrai ne se republie jamais
    // (replay de job BullMQ, double clic, retry après timeout réseau).
    if (schedule.status === 'PUBLISHED' && schedule.externalPostId) {
      logger.info('publish skipped — already published (idempotent replay)', {
        requestId,
        scheduleId: schedule.id,
        externalPostId: schedule.externalPostId,
      });
      return {
        success: true,
        simulated: false,
        mocked: false,
        externalPostId: schedule.externalPostId,
      };
    }

    // Publication PARTIE mais non vérifiée (ACTION_REQUIRED avec identifiant
    // externe) : le contenu est déjà en ligne — republier créerait un doublon
    // réel. On ne relance jamais automatiquement ce cas.
    if (schedule.status === 'ACTION_REQUIRED' && schedule.externalPostId) {
      logger.info('publish skipped — already on network, unverified (ACTION_REQUIRED)', {
        requestId,
        scheduleId: schedule.id,
        externalPostId: schedule.externalPostId,
      });
      return {
        success: true,
        simulated: false,
        mocked: false,
        externalPostId: schedule.externalPostId,
      };
    }

    // Créneau déjà en vol (PUBLISHING) ou en attente passerelle (PROCESSING) :
    // un replay concurrent (worker + cron, double invocation de cron, double
    // clic) ne doit pas relancer l'appel réseau. Seul l'appelant qui vient de
    // réserver le créneau (claim conditionnel) passe.
    if (
      !opts?.claimedByCaller &&
      (schedule.status === 'PUBLISHING' || schedule.status === 'PROCESSING')
    ) {
      logger.info('publish skipped — already in flight (concurrent replay)', {
        requestId,
        scheduleId: schedule.id,
        status: schedule.status,
      });
      return {
        success: false,
        simulated: false,
        mocked: false,
        error: 'Publication déjà en cours pour ce créneau — replay ignoré.',
      };
    }

    // Un texte de repli simulé ne part JAMAIS sur un réseau réel.
    if (isRealMode() && /^\s*\[mock\b/i.test(input.body ?? '')) {
      await updateScheduleStatus(schedule.id, 'FAILED', {
        errorMessage:
          'Texte simulé ([mock]) détecté — régénère la caption réelle avant de publier.',
      }).catch(() => undefined);
      return {
        success: false,
        simulated: false,
        mocked: false,
        error: 'Texte simulé ([mock]) — publication refusée.',
        errorCode: 'VALIDATION',
      };
    }

    if (!schedule.socialAccount) {
      await updateScheduleStatus(schedule.id, 'MANUAL_SHARE_REQUIRED', {
        errorMessage: 'Aucun compte social connecté — partage manuel requis.',
      }).catch(() => undefined);
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

    // Résolution du token natif (déchiffré) — les adaptateurs restent DB-free.
    let accessToken: string | null = null;
    if (isRealMode()) {
      const resolved = await this.resolveAccessToken(schedule.socialAccount.id);
      accessToken = resolved.token;
    }

    // Routage passerelle: préférence compte → native (token) → Late → manuel.
    // En simulation, on reste sur native (les adaptateurs simulent proprement).
    const gateway = isRealMode()
      ? SocialGatewayService.resolveGateway(schedule.socialAccount, !!accessToken)
      : 'native';

    const attemptNumber = schedule.attempts + 1;
    const idempotencyKey = `publish:${schedule.id}:${attemptNumber}`;
    const attemptRow = await db.publishAttempt
      .create({
        data: {
          scheduleId: schedule.id,
          organizationId: schedule.post?.organizationId ?? null,
          platform: schedule.socialAccount.platform,
          provider: gateway,
          mode: isRealMode() && gateway !== 'manual' ? 'REAL' : 'SIMULATED',
          attempt: attemptNumber,
          idempotencyKey,
          requestId,
        },
      })
      .catch((err) => {
        // Table absente tant que la DB n'est pas migrée — on publie quand même,
        // le journal est un plus, pas un bloqueur.
        logger.warn('PublishAttempt non enregistré', { requestId, err: (err as Error).message });
        return null;
      });

    let result: GatewayPublishResult;
    try {
      result = await SocialGatewayService.publish(gateway, input, {
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
        gateway,
      };
    }

    if (attemptRow) {
      await db.publishAttempt
        .update({
          where: { id: attemptRow.id },
          data: {
            externalPostId: result.externalPostId ?? null,
            externalUrl: result.externalUrl ?? null,
            errorCode: result.errorCode ?? null,
            errorMessage: result.error ?? null,
            response: {
              success: result.success,
              simulated: result.simulated,
              gateway: result.gateway,
              gatewayRef: result.gatewayRef ?? null,
              verified: result.verified ?? null,
            },
            finishedAt: new Date(),
          },
        })
        .catch((err) =>
          logger.warn('PublishAttempt update failed', { requestId, err: (err as Error).message }),
        );
    }

    const status = scheduleStatusFor(result);
    await updateScheduleStatus(schedule.id, status, {
      // publishedAt is reserved for REAL publications. On n'EFFACE jamais une
      // preuve déjà enregistrée : un retry raté remettait publishedAt et
      // externalPostId à null et perdait le seul verrou d'idempotence.
      ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
      // externalPostId only ever holds a REAL platform id (adapters no longer synthesize any).
      ...(result.externalPostId ? { externalPostId: result.externalPostId } : {}),
      errorMessage:
        result.verified === false && result.success
          ? 'Le réseau a renvoyé un identifiant mais la relecture de vérification a échoué — vérifiez la publication manuellement.'
          : result.error ?? null,
    });

    if (result.success && status !== 'ACTION_REQUIRED') {
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
      // Le post est parti : une demande de validation encore ouverte n'a plus
      // de sens (elle restait « En attente » à vie dans Validations).
      await closePendingApprovals(schedule.postId).catch((err) =>
        logger.warn('closePendingApprovals failed', { postId: schedule.postId, err: (err as Error).message }),
      );
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
      requestId,
      scheduleId: schedule.id,
      platform: schedule.socialAccount.platform,
      gateway: result.gateway,
      status,
      simulated: result.simulated,
      verified: result.verified ?? null,
      attempt: attemptNumber,
      externalPostId: result.externalPostId ?? null,
    });
    return result;
  },
};
