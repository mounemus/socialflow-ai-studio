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
import { isVideoMedia } from '@/lib/media-kind';
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
  // WhatsApp n'est pas publiable (conversation uniquement) — entrée requise pour
  // l'exhaustivité du Record, jamais atteinte (publish() n'est jamais appelé
  // pour ce compte, cf. platformAdapters.WHATSAPP ci-dessous).
  WHATSAPP: 'whatsapp',
  // Email n'est pas publiable via Zernio (boîte de réception uniquement) —
  // entrée requise pour l'exhaustivité, jamais atteinte.
  EMAIL: 'email',
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
  pushLateTrace({
    at: new Date().toISOString(),
    path: path.split('?')[0],
    status: res.status,
    keys: Object.keys(json as Record<string, unknown>).slice(0, 12),
    // Le corps d'erreur dit POURQUOI (param invalide, id attendu…) — capital
    // pour ajuster les appels à une API non documentée. En succès, un court
    // échantillon du corps (shape réelle) pour la même raison.
    ...(res.ok ? { sample: JSON.stringify(json).slice(0, 300) } : { err: JSON.stringify(json).slice(0, 160) }),
  });
  if (!res.ok) {
    throw new Error(`Late API ${res.status}: ${json.message ?? JSON.stringify(json.error ?? json).slice(0, 200)}`);
  }
  return json;
}

/** Variante non-throw — nécessaire pour choisir la stratégie de retry sur le code HTTP. */
async function lateFetchRaw(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const key = apiKey();
  if (!key) return { ok: false, status: 0, json: { error: 'LATE_API_KEY manquant' } };
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Diagnostic : les shapes de l'API inbox/analytics Zernio ne sont pas
  // documentées — on garde les derniers échanges en mémoire (exposés par
  // /api/inbox/sync-now) car Vercel ne conserve qu'une ligne de log/requête.
  pushLateTrace({
    at: new Date().toISOString(),
    path: path.split('?')[0],
    status: res.status,
    keys: Object.keys(json).slice(0, 12),
    ...(res.ok ? {} : { err: JSON.stringify(json).slice(0, 160) }),
  });
  return { ok: res.ok, status: res.status, json };
}

export interface LateTrace { at: string; path: string; status: number; keys: string[]; err?: string; sample?: string }
const lateTraces: LateTrace[] = [];
function pushLateTrace(t: LateTrace) {
  lateTraces.push(t);
  if (lateTraces.length > 20) lateTraces.shift();
}
/** Derniers échanges HTTP avec l'API Zernio (buffer mémoire par instance). */
export function getLateTraces(): LateTrace[] {
  return [...lateTraces];
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v) return v;
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/** Trouve le premier tableau exploitable parmi plusieurs clés candidates (shape Zernio non figée). */
function extractArray(source: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const k of keys) {
    const v = source[k];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
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
              mediaItems: input.mediaUrls.map((url) => {
                const path = url.split('?')[0].toLowerCase();
                // ponytail: détection par URL (mp4/mov/webm/m4v) — faire
                // transiter `kind` dans PublishInput si un fournisseur vidéo
                // sert des URLs sans extension.
                const isVideo = isVideoMedia({ url });
                // Indices de format : Zernio/Instagram valident le fichier à
                // partir de l'URL et du type — sans eux, « unrecognized file
                // format » sur nos médias servis par l'app.
                const mimeType = isVideo
                  ? 'video/mp4'
                  : /\.jpe?g$/.test(path) ? 'image/jpeg' : /\.png$/.test(path) ? 'image/png' : undefined;
                const filename = path.split('/').pop() || undefined;
                return { type: isVideo ? 'video' : 'image', url, ...(mimeType ? { mimeType } : {}), ...(filename && filename.includes('.') ? { filename } : {}) };
              }),
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

// =========================================================================
// Inbox (Conversations) — commentaires, DM, réponse via la passerelle Zernio.
// Shapes non documentées officiellement (comme les métriques) : parsing
// défensif, jamais de throw — [] / null + warn sur toute forme inattendue.
// =========================================================================

export interface LateComment {
  externalId: string;
  text: string;
  authorName?: string;
  authorId?: string;
  /** true = écrit par le compte connecté lui-même (nos propres réponses). */
  isOwner: boolean;
  parentId?: string;
  createdAt?: string;
  platform?: string;
  raw: unknown;
}

function parseComment(entry: Record<string, unknown>): LateComment | null {
  const externalId = firstString(entry._id, entry.id, entry.commentId);
  if (!externalId) return null;
  const author = { ...asRecord(entry.author), ...asRecord(entry.from) };
  return {
    externalId,
    text: firstString(entry.text, entry.message, entry.body, entry.content) ?? '',
    authorName: firstString(entry.authorName, author.name, author.displayName, author.username),
    authorId: firstString(entry.authorId, author.id, author._id),
    isOwner: author.isOwner === true,
    parentId: firstString(entry.parentId),
    // `createdTime` = nom réel dans l'OpenAPI Zernio (sinon receivedAt tombait sur « maintenant »).
    createdAt: firstString(entry.createdTime, entry.createdAt, entry.created_at, entry.timestamp),
    platform: firstString(entry.platform),
    raw: entry,
  };
}

/**
 * GET /inbox/comments/{latePostId}?accountId= — commentaires d'un post (accountId exigé).
 * Les réponses imbriquées (`replies[]`, un niveau) sont aplaties dans le résultat.
 */
export async function listLateComments(latePostId: string, accountId: string): Promise<LateComment[]> {
  try {
    const res = await lateFetch<Record<string, unknown>>(
      `/inbox/comments/${encodeURIComponent(latePostId)}?accountId=${encodeURIComponent(accountId)}&limit=100`,
    );
    const out: LateComment[] = [];
    for (const entry of extractArray(res, ['comments', 'data', 'items'])) {
      const top = parseComment(entry);
      if (!top) continue;
      out.push(top);
      for (const rep of asArray(entry.replies)) {
        const r = parseComment(rep);
        if (r) out.push({ ...r, parentId: r.parentId ?? top.externalId });
      }
    }
    return out;
  } catch (err) {
    logger.warn('Zernio listLateComments échoué', { latePostId, err: (err as Error).message });
    return [];
  }
}

export interface LateCommentedPost {
  latePostId: string;
  accountId: string;
  platform?: string;
  isAd: boolean;
}

/**
 * GET /inbox/comments — TOUS les posts commentés des comptes connectés (pas
 * seulement ceux publiés via SocialFlow). Les lignes publicitaires (`isAd`)
 * ont leur fil ailleurs (/ads/{adId}/comments) : signalées, non traitées ici.
 * ponytail: première page (limit=100) — ajouter le suivi de `pagination.nextCursor`
 * si un compte dépasse 100 posts commentés sur la fenêtre `since`.
 */
export async function listLateCommentedPosts(opts: { profileId?: string; since?: Date } = {}): Promise<LateCommentedPost[]> {
  try {
    // minComments=1 : sans lui, la liste renvoie aussi les posts à 0 commentaire
    // (constaté en prod : 13 posts listés, 0 commentaire → 13 appels inutiles).
    const params = new URLSearchParams({ limit: '100', minComments: '1' });
    if (opts.profileId) params.set('profileId', opts.profileId);
    if (opts.since) params.set('since', opts.since.toISOString());
    const res = await lateFetch<Record<string, unknown>>(`/inbox/comments?${params.toString()}`);
    return extractArray(res, ['data', 'posts', 'items']).flatMap((row) => {
      const latePostId = firstString(row.id, row._id, row.postId);
      const accountId = firstString(row.accountId, asRecord(row.account)._id, asRecord(row.account).id);
      if (!latePostId || !accountId) return [];
      return [{ latePostId, accountId, platform: firstString(row.platform), isAd: row.isAd === true }];
    });
  } catch (err) {
    logger.warn('Zernio listLateCommentedPosts échoué', { err: (err as Error).message });
    return [];
  }
}

export interface LateMention {
  id: string;
  accountId?: string;
  platform?: string;
  content: string;
  authorName?: string;
  authorId?: string;
  permalink?: string;
  publishedAt?: string;
  raw: unknown;
}

/** GET /inbox/mentions — mentions des pages/organisations connectées (LinkedIn aujourd'hui, via webhooks Zernio). */
export async function listLateMentions(profileId?: string): Promise<LateMention[]> {
  try {
    const params = new URLSearchParams({ limit: '100' });
    if (profileId) params.set('profileId', profileId);
    const res = await lateFetch<Record<string, unknown>>(`/inbox/mentions?${params.toString()}`);
    return extractArray(res, ['data', 'mentions', 'items']).flatMap((row) => {
      const id = firstString(row.id, row._id);
      const content = firstString(row.content, row.text, row.message);
      if (!id || !content) return [];
      return [{
        id,
        accountId: firstString(row.accountId),
        platform: firstString(row.platform),
        content,
        authorName: firstString(row.authorName, row.authorUsername),
        authorId: firstString(row.authorUsername, row.authorUrn),
        permalink: firstString(row.permalink),
        publishedAt: firstString(row.publishedAt, row.createdAt),
        raw: row,
      }];
    });
  } catch (err) {
    logger.warn('Zernio listLateMentions échoué', { err: (err as Error).message });
    return [];
  }
}

/**
 * POST /inbox/comments/{latePostId} — répond à un commentaire. La forme du
 * corps attendu n'est pas documentée: on essaie {message}, puis {text}, puis
 * {body} en cas de 400 (shape rejetée). Toute autre erreur HTTP est terminale.
 */
export async function replyLateComment(
  latePostId: string,
  text: string,
  accountId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postWithBodyFallback(
    `/inbox/comments/${encodeURIComponent(latePostId)}?accountId=${encodeURIComponent(accountId)}`,
    text,
    accountId,
  );
}

async function postWithBodyFallback(
  path: string,
  text: string,
  accountId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const extra: Record<string, string> = accountId ? { accountId } : {};
  const bodies: Record<string, string>[] = [
    { message: text, ...extra },
    { text, ...extra },
    { body: text, ...extra },
  ];
  let lastError = 'Zernio: échec inconnu';
  for (const body of bodies) {
    const res = await lateFetchRaw(path, { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    lastError = firstString(res.json.message, res.json.error) ?? `HTTP ${res.status}`;
    if (res.status !== 400) break; // pas un problème de shape — inutile de retenter
  }
  logger.warn('Zernio postWithBodyFallback échoué', { path, error: lastError });
  return { ok: false, error: lastError };
}

export interface LateConversation {
  conversationId: string;
  /** Id du compte Zernio propriétaire — EXIGÉ en query par les endpoints inbox. */
  accountId?: string;
  platform?: string;
  participantName?: string;
  lastMessage?: { id?: string; text?: string; from?: string; createdAt?: string };
  messages?: unknown[];
  raw: unknown;
}

function parseConversation(entry: Record<string, unknown>): LateConversation | null {
  const conversationId = firstString(entry._id, entry.id, entry.conversationId);
  if (!conversationId) return null;
  const accountRec = asRecord(entry.account);
  const messages = asArray(entry.messages);
  // OpenAPI : `lastMessage` est une STRING (aperçu) ; on tolère aussi un objet.
  const lastRaw = {
    ...asRecord(messages[messages.length - 1]),
    ...(typeof entry.lastMessage === 'string' ? { text: entry.lastMessage } : asRecord(entry.lastMessage)),
  };
  const participant = { ...asRecord(entry.participant), ...asRecord(entry.contact), ...asRecord(entry.from) };
  return {
    conversationId,
    accountId: firstString(entry.accountId, entry.account_id, accountRec._id, accountRec.id),
    platform: firstString(entry.platform),
    participantName: firstString(entry.participantName, participant.name, participant.displayName, participant.username),
    lastMessage: {
      id: firstString(lastRaw.id, lastRaw._id),
      text: firstString(
        lastRaw.text, lastRaw.message, lastRaw.body, lastRaw.content,
        // Certains formats mettent l'aperçu au niveau conversation.
        entry.lastMessageText, entry.lastMessagePreview, entry.snippet, entry.preview,
      ),
      from: firstString(lastRaw.from, lastRaw.authorId, lastRaw.senderId, lastRaw.fromId),
      createdAt: firstString(lastRaw.createdAt, lastRaw.created_at, lastRaw.timestamp),
    },
    messages: entry.messages as unknown[] | undefined,
    raw: entry,
  };
}

/**
 * GET /inbox/conversations — toutes les conversations DM accessibles par la
 * clé API. `profileId` n'est pas documenté sur cet endpoint mais est accepté
 * par les autres routes Zernio (ex. /accounts) — on le passe quand connu pour
 * limiter le risque de mélange multi-tenant; Zernio l'ignorera sinon.
 * ponytail: si l'API ne le respecte pas, les DM de plusieurs organisations
 * partageant la même clé API pourraient apparaître dans chacune — ajouter un
 * filtre applicatif si ça se confirme en usage réel.
 */
export interface LateMessage {
  id?: string;
  text?: string;
  from?: string;
  outbound?: boolean;
  createdAt?: string;
  raw: unknown;
}

/**
 * GET /inbox/conversations/{id}/messages — les messages d'une conversation.
 * Nécessaire car la liste des conversations ne porte pas le texte des
 * messages (constaté en prod : « dm-sans-texte » pour chaque conversation).
 */
export async function listLateMessages(conversationId: string, accountId: string): Promise<LateMessage[]> {
  try {
    const qs = `?accountId=${encodeURIComponent(accountId)}`;
    let res: Record<string, unknown> = {};
    try {
      res = await lateFetch<Record<string, unknown>>(
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages${qs}`,
      );
    } catch {
      // 404/refus — certains déploiements ne servent que le détail.
    }
    let rows = extractArray(res, ['messages', 'data', 'items']);
    if (rows.length === 0) {
      // Repli : le détail de la conversation porte parfois les messages.
      try {
        const detail = await lateFetch<Record<string, unknown>>(
          `/inbox/conversations/${encodeURIComponent(conversationId)}${qs}`,
        );
        const conv = { ...detail, ...asRecord(detail.conversation) };
        rows = extractArray(conv, ['messages', 'data', 'items']);
      } catch {
        // trace déjà enregistrée par lateFetch
      }
    }
    return rows.map((m) => {
      const r = asRecord(m);
      const direction = firstString(r.direction, r.type);
      const outboundFlag = [r.isOutbound, r.outgoing, r.fromMe, r.isFromMe, r.sentByMe].some((v) => v === true)
        || (direction ? /out|sent/i.test(direction) : false);
      return {
        id: firstString(r._id, r.id, r.messageId),
        text: firstString(r.text, r.message, r.body, r.content),
        from: firstString(r.from, r.senderName, r.sender, r.authorId, r.senderId),
        outbound: outboundFlag,
        createdAt: firstString(r.createdAt, r.created_at, r.timestamp, r.sentAt),
        raw: m,
      };
    });
  } catch (err) {
    logger.warn('Zernio listLateMessages échoué', { conversationId, err: (err as Error).message });
    return [];
  }
}

export async function listLateConversations(profileId?: string): Promise<LateConversation[]> {
  try {
    const qs = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
    const res = await lateFetch<Record<string, unknown>>(`/inbox/conversations${qs}`);
    return extractArray(res, ['conversations', 'data', 'items'])
      .map(parseConversation)
      .filter((c): c is LateConversation => c !== null);
  } catch (err) {
    logger.warn('Zernio listLateConversations échoué', { err: (err as Error).message });
    return [];
  }
}

/** POST /inbox/conversations/{conversationId}/messages — envoie un message DM. */
export async function sendLateMessage(
  conversationId: string,
  text: string,
  accountId: string,
): Promise<{ ok: boolean; error?: string }> {
  return postWithBodyFallback(
    `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}`,
    text,
    accountId,
  );
}

/**
 * GET /analytics/{latePostId} — réutilise parsePlatformStats (même parsing
 * tolérant que getLatePostMetrics) puisque la forme des métriques est la même
 * incertitude documentaire.
 */
export async function getLateAnalytics(latePostId: string, accountId?: string): Promise<LateMetrics | null> {
  try {
    const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    const res = await lateFetch<Record<string, unknown>>(`/analytics/${encodeURIComponent(latePostId)}${qs}`);
    return parsePlatformStats(res);
  } catch (err) {
    logger.warn('Zernio getLateAnalytics échoué', { latePostId, err: (err as Error).message });
    return null;
  }
}
