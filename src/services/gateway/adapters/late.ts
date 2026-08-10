/**
 * LateGatewayAdapter — publication via l'agrégateur Late (rebrandé Zernio).
 * Couvre à moindre coût les plateformes sans intégration native (X, TikTok,
 * YouTube, Pinterest...) tout que restant derrière l'abstraction gateway.
 *
 * API (docs.zernio.com, vérifiée 2026-07):
 *   POST {base}/posts  Authorization: Bearer LATE_API_KEY
 *     { content, platforms:[{platform, accountId}], mediaItems:[{type,url}],
 *       publishNow:true | scheduledFor+timezone }
 *   → { post: { _id, status: scheduled|publishing|published|draft|failed,
 *               platforms:[...], platformPostUrl } }
 *   GET {base}/posts/{id} → statut à jour.
 *
 * Mapping des comptes : SocialAccount.metadata.lateAccountId (renseigné à la
 * connexion du compte côté Late). Sans mapping → cette passerelle ne prend
 * pas le compte en charge.
 *
 * Vérité opérationnelle : PUBLISHED seulement quand Late confirme "published"
 * avec une URL/id; sinon PROCESSING (le webhook ou le polling terminera).
 */
import type { SocialAccount, SocialPlatform } from '@prisma/client';
import { logger } from '@/lib/logger';
import { composeMessage, isRealMode, publishFailure, simulatedResult } from '@/services/publisher/adapters/_shared';
import type { PublishInput } from '@/services/publisher/types';
import type { GatewayContext, GatewayPublishResult, PublicationStatus, SocialGatewayAdapter } from '../types';

const LATE_PLATFORMS: Record<SocialPlatform, string> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  LINKEDIN: 'linkedin',
  TWITTER: 'twitter',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  PINTEREST: 'pinterest',
};

function baseUrl(): string {
  return (process.env.LATE_API_BASE ?? 'https://zernio.com/api/v1').replace(/\/$/, '');
}

function apiKey(): string | undefined {
  return process.env.LATE_API_KEY ?? process.env.ZERNIO_API_KEY;
}

export function lateAccountIdOf(account: SocialAccount): string | null {
  const meta = (account.metadata ?? {}) as Record<string, unknown>;
  return typeof meta.lateAccountId === 'string' && meta.lateAccountId ? meta.lateAccountId : null;
}

async function lateFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error('LATE_API_KEY manquant');
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown; message?: string };
  if (!res.ok) {
    throw new Error(`Late API ${res.status}: ${json.message ?? JSON.stringify(json.error ?? json).slice(0, 200)}`);
  }
  return json;
}

interface LatePost {
  _id: string;
  status: 'scheduled' | 'publishing' | 'published' | 'draft' | 'failed' | 'partial';
  platformPostUrl?: string;
  // Champs statistiques non documentés officiellement — Zernio les expose
  // parfois selon la plateforme (analytics/stats/metrics imbriqués, ou champs
  // plats likes/impressions/views...). On parse défensivement, voir plus bas.
  platforms?: ({ platform: string; platformPostId?: string; platformPostUrl?: string } & Record<
    string,
    unknown
  >)[];
}

export interface LateMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
}

// Alias connus par plateforme → notre schéma interne. Volontairement large :
// mieux vaut capter une métrique sous un nom inattendu que de tout perdre.
const METRIC_KEY_MAP: Record<string, keyof LateMetrics> = {
  impressions: 'impressions',
  impression_count: 'impressions',
  views: 'impressions',
  view_count: 'impressions',
  plays: 'impressions',
  play_count: 'impressions',
  reach: 'reach',
  reach_count: 'reach',
  likes: 'likes',
  like_count: 'likes',
  favorites: 'likes',
  favorite_count: 'likes',
  comments: 'comments',
  comment_count: 'comments',
  shares: 'shares',
  share_count: 'shares',
  retweets: 'shares',
  retweet_count: 'shares',
  clicks: 'clicks',
  click_count: 'clicks',
  link_clicks: 'clicks',
};

function extractMetrics(source: unknown): Partial<LateMetrics> {
  if (!source || typeof source !== 'object') return {};
  const out: Partial<LateMetrics> = {};
  for (const [key, val] of Object.entries(source as Record<string, unknown>)) {
    const target = METRIC_KEY_MAP[key.toLowerCase()];
    if (target && typeof val === 'number' && Number.isFinite(val)) {
      out[target] = (out[target] ?? 0) + val;
    }
  }
  return out;
}

/** Parse tout ce qui ressemble à des métriques sur une entrée platforms[]; null si rien trouvé. */
function parsePlatformStats(entry: Record<string, unknown> | undefined): LateMetrics | null {
  if (!entry) return null;
  const nested = [entry.analytics, entry.stats, entry.metrics].find(
    (v) => v && typeof v === 'object',
  );
  const merged = { ...extractMetrics(entry), ...extractMetrics(nested) };
  const hasAny = Object.values(merged).some((v) => typeof v === 'number' && v > 0);
  if (!hasAny) return null;
  return {
    impressions: merged.impressions ?? 0,
    reach: merged.reach ?? 0,
    likes: merged.likes ?? 0,
    comments: merged.comments ?? 0,
    shares: merged.shares ?? 0,
    clicks: merged.clicks ?? 0,
  };
}

function toPublicationStatus(post: LatePost): PublicationStatus {
  const pf = post.platforms?.[0];
  if (post.status === 'published') {
    return {
      status: 'PUBLISHED',
      externalPostId: pf?.platformPostId,
      externalUrl: pf?.platformPostUrl ?? post.platformPostUrl,
      raw: post,
    };
  }
  // 'partial' = certaines plateformes ont échoué. Nous n'envoyons qu'UNE
  // plateforme par post — partial est donc traité comme un échec explicite.
  if (post.status === 'failed' || post.status === 'partial') return { status: 'FAILED', raw: post };
  if (post.status === 'publishing') return { status: 'PROCESSING', raw: post };
  if (post.status === 'scheduled') return { status: 'QUEUED', raw: post };
  return { status: 'UNKNOWN', raw: post };
}

export const lateGatewayAdapter: SocialGatewayAdapter = {
  id: 'late',
  isConfigured: () => !!apiKey(),
  supports(_platform: SocialPlatform, account: SocialAccount) {
    return !!apiKey() && !!lateAccountIdOf(account);
  },

  async publish(input: PublishInput, ctx: GatewayContext): Promise<GatewayPublishResult> {
    if (!isRealMode()) return { ...simulatedResult('late', input), gateway: 'late' };
    const lateAccountId = lateAccountIdOf(ctx.account);
    if (!lateAccountId) {
      return {
        ...publishFailure(
          'Compte non mappé côté Late (metadata.lateAccountId manquant) — connectez le compte dans Late puis renseignez le mapping.',
          'MISSING_TARGET',
        ),
        gateway: 'late',
      };
    }

    try {
      const body = {
        content: composeMessage(input),
        platforms: [{ platform: LATE_PLATFORMS[ctx.account.platform], accountId: lateAccountId }],
        ...(input.mediaUrls.length
          ? {
              mediaItems: input.mediaUrls.map((url) => ({
                type: url.endsWith('.mp4') ? 'video' : 'image',
                url,
              })),
            }
          : {}),
        publishNow: true,
      };
      const created = await lateFetch<{ post: LatePost }>(`/posts`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      // Late publie en asynchrone — courte fenêtre de polling avant de rendre la main.
      let post = created.post;
      for (let i = 0; i < 5 && post.status !== 'published' && post.status !== 'failed'; i++) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        const read = await lateFetch<{ post: LatePost }>(`/posts/${encodeURIComponent(post._id)}`);
        post = read.post;
      }

      const status = toPublicationStatus(post);
      if (status.status === 'PUBLISHED') {
        return {
          success: true,
          simulated: false,
          mocked: false,
          externalPostId: status.externalPostId,
          externalUrl: status.externalUrl,
          gateway: 'late',
          gatewayRef: post._id,
          verified: !!status.externalPostId || !!status.externalUrl,
        };
      }
      if (status.status === 'FAILED') {
        return { ...publishFailure('Late: publication échouée côté agrégateur.', 'API_ERROR'), gateway: 'late', gatewayRef: post._id };
      }
      // Toujours en cours — le webhook /api/webhooks/late (ou le polling)
      // finalisera. On ne prétend PAS que c'est publié.
      logger.info('Late: publication en cours (async)', { lateRef: post._id, status: post.status });
      return {
        success: false,
        simulated: false,
        mocked: false,
        error: `Late: traitement en cours (${post.status}) — statut finalisé par webhook/polling.`,
        errorCode: 'PENDING',
        gateway: 'late',
        gatewayRef: post._id,
      };
    } catch (err) {
      return { ...publishFailure(`Late: ${(err as Error).message}`, 'API_ERROR'), gateway: 'late' };
    }
  },

  async getPublicationStatus(gatewayRef: string): Promise<PublicationStatus> {
    const read = await lateFetch<{ post: LatePost }>(`/posts/${encodeURIComponent(gatewayRef)}`);
    return toPublicationStatus(read.post);
  },
};

/**
 * Métriques d'un post publié via Zernio, pour les comptes sans token natif.
 * GET /posts/{gatewayRef} — la forme exacte des stats n'est pas documentée
 * (varie par plateforme), donc on parse défensivement (voir parsePlatformStats)
 * et on retourne null quand rien d'exploitable n'est trouvé — jamais de zéros
 * fabriqués faute de données.
 */
export async function getLatePostMetrics(
  gatewayRef: string,
): Promise<{ metrics: LateMetrics | null; raw: unknown }> {
  const read = await lateFetch<{ post: LatePost }>(`/posts/${encodeURIComponent(gatewayRef)}`);
  const entry = read.post.platforms?.[0];
  const metrics =
    parsePlatformStats(entry) ?? parsePlatformStats(read.post as unknown as Record<string, unknown>);
  return { metrics, raw: entry ?? read.post };
}
