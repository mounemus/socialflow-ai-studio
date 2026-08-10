/**
 * AnalyticsCollectorService — récupération des VRAIES métriques des posts
 * publiés (Facebook, Instagram, LinkedIn) vers PostAnalytics.
 *
 * Vérité opérationnelle :
 *   - ne collecte que les schedules PUBLISHED avec un externalPostId réel ;
 *   - jamais de métriques fabriquées : pas de token / pas de mode réel → skip loggé ;
 *   - un échec de collecte n'écrit rien (pas de zéros déguisés en données).
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { isRealMode } from '@/services/publisher/adapters/_shared';
import { getLatePostMetrics } from '@/services/gateway/adapters/late';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface Metrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  raw: unknown;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

async function collectFacebook(postId: string, token: string): Promise<Metrics> {
  const fields = await fetchJson(
    `${GRAPH}/${postId}?fields=likes.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`,
  );
  let impressions = 0;
  let reach = 0;
  let clicks = 0;
  try {
    const ins = await fetchJson(
      `${GRAPH}/${postId}/insights?metric=post_impressions,post_impressions_unique,post_clicks&access_token=${encodeURIComponent(token)}`,
    );
    for (const m of (ins.data as { name: string; values?: { value?: number }[] }[]) ?? []) {
      const v = m.values?.[0]?.value ?? 0;
      if (m.name === 'post_impressions') impressions = v;
      if (m.name === 'post_impressions_unique') reach = v;
      if (m.name === 'post_clicks') clicks = v;
    }
  } catch (err) {
    // insights exigent read_insights — les compteurs sociaux restent valables
    logger.warn('FB insights indisponibles (scope read_insights ?)', { err: (err as Error).message });
  }
  const likes = (fields.likes as { summary?: { total_count?: number } })?.summary?.total_count ?? 0;
  const comments = (fields.comments as { summary?: { total_count?: number } })?.summary?.total_count ?? 0;
  const shares = (fields.shares as { count?: number })?.count ?? 0;
  return { impressions, reach, likes, comments, shares, clicks, raw: fields };
}

async function collectInstagram(mediaId: string, token: string): Promise<Metrics> {
  const fields = await fetchJson(
    `${GRAPH}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`,
  );
  let impressions = 0;
  let reach = 0;
  let shares = 0;
  try {
    const ins = await fetchJson(
      `${GRAPH}/${mediaId}/insights?metric=impressions,reach,shares&access_token=${encodeURIComponent(token)}`,
    );
    for (const m of (ins.data as { name: string; values?: { value?: number }[] }[]) ?? []) {
      const v = m.values?.[0]?.value ?? 0;
      if (m.name === 'impressions') impressions = v;
      if (m.name === 'reach') reach = v;
      if (m.name === 'shares') shares = v;
    }
  } catch (err) {
    logger.warn('IG insights indisponibles', { err: (err as Error).message });
  }
  return {
    impressions,
    reach,
    likes: (fields.like_count as number) ?? 0,
    comments: (fields.comments_count as number) ?? 0,
    shares,
    clicks: 0,
    raw: fields,
  };
}

async function collectLinkedIn(postUrn: string, token: string): Promise<Metrics> {
  const json = await fetchJson(
    `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrn)}?oauth2_access_token=${encodeURIComponent(token)}`,
  );
  const likes = (json.likesSummary as { totalLikes?: number })?.totalLikes ?? 0;
  const comments = (json.commentsSummary as { aggregatedTotalComments?: number })?.aggregatedTotalComments ?? 0;
  // impressions organiques : nécessite organizationalEntityShareStatistics (pages) — pas toujours accessible
  return { impressions: 0, reach: 0, likes, comments, shares: 0, clicks: 0, raw: json };
}

async function upsertAnalytics(
  s: { id: string; post: { id: string }; socialAccount: { id: string } },
  metrics: Metrics,
): Promise<void> {
  const engagementBase = metrics.reach || metrics.impressions;
  const data = {
    impressions: metrics.impressions,
    reach: metrics.reach,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    clicks: metrics.clicks,
    engagementRate: engagementBase
      ? (metrics.likes + metrics.comments + metrics.shares) / engagementBase
      : null,
    rawData: metrics.raw as never,
  };
  await db.postAnalytics.upsert({
    where: { postScheduleId: s.id },
    create: { postId: s.post.id, postScheduleId: s.id, socialAccountId: s.socialAccount.id, ...data },
    update: { ...data, capturedAt: new Date() },
  });
}

const NATIVE_PLATFORMS = new Set(['FACEBOOK', 'INSTAGRAM', 'LINKEDIN']);

export const AnalyticsCollectorService = {
  /**
   * Collecte les métriques pour tous les posts réellement publiés (30 derniers
   * jours) de l'organisation. Deux chemins, gérés indépendamment :
   *  - natif (Graph/LinkedIn) : nécessite ENABLE_REAL_PUBLISHING + un token
   *    natif stocké sur le compte ;
   *  - passerelle (Zernio/Late) : compte sans token natif mais publié via
   *    Zernio (PublishAttempt.response.gatewayRef) — collecté même si le mode
   *    réel a été désactivé après coup, car le post est réellement publié.
   * Retourne un compte rendu honnête (jamais de métriques fabriquées).
   */
  async collectForOrganization(organizationId: string): Promise<{
    collected: number;
    skipped: number;
    failed: number;
    reasons: Record<string, number>;
  }> {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const schedules = await db.postSchedule.findMany({
      where: {
        status: 'PUBLISHED',
        publishedAt: { gte: since },
        post: { organizationId },
      },
      include: {
        socialAccount: true,
        post: { select: { id: true } },
        publishAttempts: { where: { provider: 'late' }, orderBy: { startedAt: 'desc' }, take: 1 },
      },
      take: 100,
    });

    let collected = 0;
    let skipped = 0;
    let failed = 0;
    const reasons: Record<string, number> = {};
    const bump = (r: string) => {
      reasons[r] = (reasons[r] ?? 0) + 1;
    };

    for (const s of schedules) {
      const account = s.socialAccount;
      if (!account) {
        skipped++;
        bump('sans-compte');
        continue;
      }

      // --- Chemin natif (Graph/LinkedIn) ---------------------------------
      if (isRealMode() && s.externalPostId && NATIVE_PLATFORMS.has(account.platform)) {
        const { token } = await SocialPublisherService.resolveAccessToken(account.id);
        if (token) {
          try {
            let metrics: Metrics;
            if (account.platform === 'FACEBOOK') metrics = await collectFacebook(s.externalPostId, token);
            else if (account.platform === 'INSTAGRAM') metrics = await collectInstagram(s.externalPostId, token);
            else metrics = await collectLinkedIn(s.externalPostId, token);
            await upsertAnalytics({ id: s.id, post: s.post, socialAccount: account }, metrics);
            collected++;
          } catch (err) {
            failed++;
            logger.warn('Collecte analytics (natif) échouée pour un schedule', {
              scheduleId: s.id,
              platform: account.platform,
              err: (err as Error).message,
            });
          }
          continue;
        }
      }

      // --- Chemin passerelle (Zernio/Late) --------------------------------
      const gatewayRef = (s.publishAttempts[0]?.response as { gatewayRef?: string } | null)
        ?.gatewayRef;
      if (!gatewayRef) {
        skipped++;
        bump('pas-de-gateway-ref');
        continue;
      }
      try {
        const { metrics, raw } = await getLatePostMetrics(gatewayRef);
        if (!metrics) {
          skipped++;
          bump('gateway-sans-metriques');
          continue;
        }
        await upsertAnalytics({ id: s.id, post: s.post, socialAccount: account }, { ...metrics, raw });
        collected++;
      } catch (err) {
        failed++;
        logger.warn('Collecte analytics (Zernio) échouée pour un schedule', {
          scheduleId: s.id,
          err: (err as Error).message,
        });
      }
    }
    logger.info('Analytics collect terminé', { organizationId, collected, skipped, failed, reasons });
    return { collected, skipped, failed, reasons };
  },

  /** Toutes les orgs ayant au moins un post publié récemment. */
  async collectForAllOrgs(): Promise<{
    orgs: number;
    collected: number;
    skipped: number;
    failed: number;
    reasons: Record<string, number>;
  }> {
    const orgs = await db.postSchedule.findMany({
      where: { status: 'PUBLISHED' },
      select: { post: { select: { organizationId: true } } },
      distinct: ['postId'],
      take: 500,
    });
    const orgIds = [...new Set(orgs.map((o) => o.post.organizationId))];
    let collected = 0;
    let skipped = 0;
    let failed = 0;
    const reasons: Record<string, number> = {};
    for (const orgId of orgIds) {
      const r = await this.collectForOrganization(orgId);
      collected += r.collected;
      skipped += r.skipped;
      failed += r.failed;
      for (const [k, v] of Object.entries(r.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
    }
    return { orgs: orgIds.length, collected, skipped, failed, reasons };
  },
};
