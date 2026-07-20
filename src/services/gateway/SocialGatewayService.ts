/**
 * SocialGatewayService — point d'entrée unique de la publication sociale.
 * L'UI et les services métier ne connaissent AUCUN fournisseur externe :
 * ils parlent à cette façade, qui route vers native / late / manual.
 *
 * Stratégie de routage (par organisation, compte et plateforme) :
 *   1. préférence explicite du compte (SocialAccount.metadata.preferredGateway) ;
 *   2. native — API officielle si l'adaptateur la supporte ET qu'un token existe ;
 *   3. late — agrégateur si LATE_API_KEY présent ET compte mappé ;
 *   4. manual — partage manuel (échec honnête, jamais de succès déguisé).
 */
import type { SocialAccount } from '@prisma/client';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { isRealMode } from '@/services/publisher/adapters/_shared';
import type { PublishInput } from '@/services/publisher/types';
import type { GatewayContext, GatewayId, GatewayPublishResult, PublicationStatus, SocialGatewayAdapter } from './types';
import { nativeGatewayAdapter } from './adapters/native';
import { lateGatewayAdapter } from './adapters/late';
import { manualGatewayAdapter } from './adapters/manual';

const adapters: Record<GatewayId, SocialGatewayAdapter> = {
  native: nativeGatewayAdapter,
  late: lateGatewayAdapter,
  manual: manualGatewayAdapter,
};

function preferredGatewayOf(account: SocialAccount): GatewayId | null {
  const meta = (account.metadata ?? {}) as Record<string, unknown>;
  const g = meta.preferredGateway;
  return g === 'native' || g === 'late' || g === 'manual' ? g : null;
}

export const SocialGatewayService = {
  adapters,

  /**
   * Choisit la passerelle pour un compte donné. `hasNativeToken` est fourni
   * par l'appelant (SocialPublisherService résout/déchiffre les tokens).
   */
  resolveGateway(account: SocialAccount, hasNativeToken: boolean): GatewayId {
    const preferred = preferredGatewayOf(account);
    if (preferred && adapters[preferred].supports(account.platform, account)) {
      return preferred;
    }
    if (nativeGatewayAdapter.supports(account.platform, account) && hasNativeToken) {
      return 'native';
    }
    if (lateGatewayAdapter.supports(account.platform, account)) {
      return 'late';
    }
    return 'manual';
  },

  async publish(
    gateway: GatewayId,
    input: PublishInput,
    ctx: GatewayContext,
  ): Promise<GatewayPublishResult> {
    const adapter = adapters[gateway];
    const result = await adapter.publish(input, ctx);
    logger.info('gateway publish', {
      gateway,
      platform: ctx.account.platform,
      success: result.success,
      simulated: result.simulated,
      verified: result.verified ?? null,
      gatewayRef: result.gatewayRef ?? null,
    });
    return result;
  },

  async getPublicationStatus(gateway: GatewayId, gatewayRef: string): Promise<PublicationStatus> {
    const adapter = adapters[gateway];
    if (!adapter.getPublicationStatus) return { status: 'UNKNOWN' };
    return adapter.getPublicationStatus(gatewayRef);
  },

  /**
   * Webhook entrant (Late) : met à jour le schedule correspondant au
   * gatewayRef. Idempotent — rejouer le même événement ne change rien.
   */
  async handleLateWebhook(payload: {
    postId?: string;
    _id?: string;
    status?: string;
    platformPostId?: string;
    platformPostUrl?: string;
  }): Promise<{ handled: boolean; scheduleId?: string }> {
    const ref = payload.postId ?? payload._id;
    if (!ref) return { handled: false };

    const attempt = await db.publishAttempt.findFirst({
      where: { provider: 'late', response: { path: ['gatewayRef'], equals: ref } },
      orderBy: { startedAt: 'desc' },
    });
    if (!attempt) {
      logger.warn('Webhook Late: gatewayRef inconnu', { ref });
      return { handled: false };
    }

    if (payload.status === 'published') {
      await db.postSchedule.update({
        where: { id: attempt.scheduleId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          externalPostId: payload.platformPostId ?? null,
          errorMessage: null,
        },
      });
      await db.publishAttempt.update({
        where: { id: attempt.id },
        data: {
          externalPostId: payload.platformPostId ?? null,
          externalUrl: payload.platformPostUrl ?? null,
          finishedAt: new Date(),
        },
      });
      const schedule = await db.postSchedule.findUnique({
        where: { id: attempt.scheduleId },
        select: { postId: true },
      });
      if (schedule) {
        await db.post.update({ where: { id: schedule.postId }, data: { status: 'PUBLISHED' } }).catch(() => undefined);
      }
    } else if (payload.status === 'failed') {
      await db.postSchedule.update({
        where: { id: attempt.scheduleId },
        data: { status: 'FAILED', errorMessage: 'Late: publication échouée (webhook).' },
      });
    } else {
      // scheduled / publishing → PROCESSING, pas de conclusion hâtive.
      await db.postSchedule
        .update({ where: { id: attempt.scheduleId }, data: { status: 'PROCESSING' } })
        .catch(() => undefined);
    }
    return { handled: true, scheduleId: attempt.scheduleId };
  },

  /** Résumé des passerelles pour le registre de capacités. */
  gatewaySummary(account: SocialAccount, hasNativeToken: boolean): {
    gateway: GatewayId;
    real: boolean;
    detail: string;
  } {
    const gateway = this.resolveGateway(account, hasNativeToken);
    if (!isRealMode()) {
      return { gateway, real: false, detail: 'ENABLE_REAL_PUBLISHING désactivé — simulation.' };
    }
    if (gateway === 'native') return { gateway, real: true, detail: 'API officielle (token natif).' };
    if (gateway === 'late') return { gateway, real: true, detail: 'Via agrégateur Late.' };
    return { gateway, real: false, detail: 'Partage manuel requis (aucune passerelle automatique).' };
  },
};
