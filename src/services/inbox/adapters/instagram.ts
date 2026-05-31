/**
 * Instagram inbox adapter — fetches new comments + mentions from Graph API.
 *
 * Endpoints used:
 *  - /me/media                 → list recent media owned by the IG Business account
 *  - /{media-id}/comments      → comments per media
 *  - /me/tags                  → recent posts the account was tagged/mentioned in
 *
 * Real network calls happen only when ENABLE_REAL_PUBLISHING=true AND a token is
 * provided. Otherwise we return [] so the orchestrator can still exercise the
 * pipeline end-to-end without burning Graph API quota.
 *
 * Defensive contract: every error is caught and logged via logger.warn. The
 * caller (InboxIngestionService) never sees a thrown exception from here.
 */
import { logger } from '@/lib/logger';
import type { IngestArgs, RawInteraction } from './types';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

async function safeFetch(url: string, label: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn('Instagram adapter non-2xx', { label, status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn('Instagram adapter fetch failed', { label, err: (err as Error).message });
    return null;
  }
}

function realMode(): boolean {
  return process.env.ENABLE_REAL_PUBLISHING === 'true';
}

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  from?: { id: string; username?: string };
  timestamp?: string;
  media?: { id: string };
}

interface IgMedia {
  id: string;
  caption?: string;
  timestamp?: string;
}

interface IgTag {
  id: string;
  caption?: string;
  username?: string;
  timestamp?: string;
}

export const instagramInboxAdapter = {
  platform: 'INSTAGRAM' as const,

  async ingestComments({ token, since }: IngestArgs): Promise<RawInteraction[]> {
    if (!token) {
      logger.warn('Instagram ingestComments: no token, skipping');
      return [];
    }
    if (!realMode()) return [];
    try {
      const mediaJson = (await safeFetch(
        `${GRAPH_BASE}/me/media?fields=id,caption,timestamp&limit=25&access_token=${encodeURIComponent(token)}`,
        'me/media',
      )) as { data?: IgMedia[] } | null;
      if (!mediaJson?.data?.length) return [];

      const out: RawInteraction[] = [];
      for (const media of mediaJson.data) {
        const commentsJson = (await safeFetch(
          `${GRAPH_BASE}/${media.id}/comments?fields=id,text,username,from,timestamp&limit=50&access_token=${encodeURIComponent(token)}`,
          `media/${media.id}/comments`,
        )) as { data?: IgComment[] } | null;
        if (!commentsJson?.data) continue;

        for (const c of commentsJson.data) {
          const receivedAt = c.timestamp ? new Date(c.timestamp) : new Date();
          if (since && receivedAt.getTime() < since.getTime()) continue;
          out.push({
            externalId: `ig_comment_${c.id}`,
            type: 'COMMENT',
            threadId: media.id,
            content: c.text ?? '',
            fromHandle: c.username ?? c.from?.username ?? c.from?.id ?? 'unknown',
            postExternalId: media.id,
            receivedAt,
            rawData: { source: 'instagram', mediaId: media.id, raw: c },
          });
        }
      }
      return out;
    } catch (err) {
      logger.warn('Instagram ingestComments failed', { err: (err as Error).message });
      return [];
    }
  },

  async ingestMentions({ token, since }: IngestArgs): Promise<RawInteraction[]> {
    if (!token) return [];
    if (!realMode()) return [];
    try {
      const json = (await safeFetch(
        `${GRAPH_BASE}/me/tags?fields=id,caption,username,timestamp&limit=25&access_token=${encodeURIComponent(token)}`,
        'me/tags',
      )) as { data?: IgTag[] } | null;
      if (!json?.data) return [];
      const out: RawInteraction[] = [];
      for (const t of json.data) {
        const receivedAt = t.timestamp ? new Date(t.timestamp) : new Date();
        if (since && receivedAt.getTime() < since.getTime()) continue;
        out.push({
          externalId: `ig_mention_${t.id}`,
          type: 'MENTION',
          content: t.caption ?? '',
          fromHandle: t.username ?? 'unknown',
          postExternalId: t.id,
          receivedAt,
          rawData: { source: 'instagram', raw: t },
        });
      }
      return out;
    } catch (err) {
      logger.warn('Instagram ingestMentions failed', { err: (err as Error).message });
      return [];
    }
  },
};
