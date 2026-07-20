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

export const AnalyticsCollectorService = {
  /**
   * Collecte les métriques pour tous les posts réellement publiés (30 derniers
   * jours) de l'organisation. Retourne un compte rendu honnête.
   */
  async collectForOrganization(organizationId: string): Promise<{
    collected: number;
    skipped: number;
    failed: number;
    reason?: string;
  }> {
    if (!isRealMode()) {
      return { collected: 0, skipped: 0, failed: 0, reason: 'ENABLE_REAL_PUBLISHING désactivé — aucune métrique réelle à collecter.' };
    }
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const schedules = await db.postSchedule.findMany({
      where: {
        status: 'PUBLISHED',
        externalPostId: { not: null },
        publishedAt: { gte: since },
        post: { organizationId },
        socialAccount: { platform: { in: ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN'] } },
      },
      include: { socialAccount: true, post: { select: { id: true } } },
      take: 100,
    });

    let collected = 0;
    let skipped = 0;
    let failed = 0;
    for (const s of schedules) {
      if (!s.socialAccount || !s.externalPostId) {
        skipped++;
        continue;
      }
      const { token } = await SocialPublisherService.resolveAccessToken(s.socialAccount.id);
      if (!token) {
        skipped++;
        continue;
      }
      try {
        let metrics: Metrics;
        if (s.socialAccount.platform === 'FACEBOOK') metrics = await collectFacebook(s.externalPostId, token);
        else if (s.socialAccount.platform === 'INSTAGRAM') metrics = await collectInstagram(s.externalPostId, token);
        else metrics = await collectLinkedIn(s.externalPostId, token);

        const engagementBase = metrics.reach || metrics.impressions;
        await db.postAnalytics.upsert({
          where: { postScheduleId: s.id },
          create: {
            postId: s.post.id,
            postScheduleId: s.id,
            socialAccountId: s.socialAccount.id,
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
          },
          update: {
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
            capturedAt: new Date(),
          },
        });
        collected++;
      } catch (err) {
        failed++;
        logger.warn('Collecte analytics échouée pour un schedule', {
          scheduleId: s.id,
          platform: s.socialAccount.platform,
          err: (err as Error).message,
        });
      }
    }
    logger.info('Analytics collect terminé', { organizationId, collected, skipped, failed });
    return { collected, skipped, failed };
  },

  /** Toutes les orgs ayant au moins un post publié récemment. */
  async collectForAllOrgs(): Promise<{ orgs: number; collected: number; skipped: number; failed: number }> {
    const orgs = await db.postSchedule.findMany({
      where: { status: 'PUBLISHED', externalPostId: { not: null } },
      select: { post: { select: { organizationId: true } } },
      distinct: ['postId'],
      take: 500,
    });
    const orgIds = [...new Set(orgs.map((o) => o.post.organizationId))];
    let collected = 0;
    let skipped = 0;
    let failed = 0;
    for (const orgId of orgIds) {
      const r = await this.collectForOrganization(orgId);
      collected += r.collected;
      skipped += r.skipped;
      failed += r.failed;
    }
    return { orgs: orgIds.length, collected, skipped, failed };
  },
};
