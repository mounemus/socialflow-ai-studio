/**
 * Facebook inbox adapter — fetches new comments on page posts + DMs.
 *
 * Endpoints used (requires pages_read_engagement + pages_messaging scopes):
 *  - /me/accounts                       → pages the user manages
 *  - /{page-id}/posts/comments          → comments on recent page posts
 *  - /me/conversations?fields=messages  → DM threads
 *
 * Real network calls only when ENABLE_REAL_PUBLISHING=true. Otherwise [].
 * Errors never propagate — they get logged and we return [].
 */
import { logger } from '@/lib/logger';
import type { IngestArgs, RawInteraction } from './types';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

function realMode(): boolean {
  return process.env.ENABLE_REAL_PUBLISHING === 'true';
}

async function safeFetch(url: string, label: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn('Facebook adapter non-2xx', { label, status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn('Facebook adapter fetch failed', { label, err: (err as Error).message });
    return null;
  }
}

interface FbPost { id: string; message?: string; created_time?: string }
interface FbComment {
  id: string;
  message?: string;
  from?: { id: string; name?: string };
  created_time?: string;
}
interface FbMessage {
  id: string;
  message?: string;
  from?: { id: string; name?: string; email?: string };
  created_time?: string;
}
interface FbConversation {
  id: string;
  messages?: { data?: FbMessage[] };
  updated_time?: string;
}

export const facebookInboxAdapter = {
  platform: 'FACEBOOK' as const,

  async ingestComments({ socialAccount, token, since }: IngestArgs): Promise<RawInteraction[]> {
    if (!token) {
      logger.warn('Facebook ingestComments: no token, skipping');
      return [];
    }
    if (!realMode()) return [];
    try {
      // For a page-style account we treat externalId as the page id directly.
      const pageId = socialAccount.externalId;
      const postsJson = (await safeFetch(
        `${GRAPH_BASE}/${pageId}/posts?fields=id,message,created_time&limit=25&access_token=${encodeURIComponent(token)}`,
        'page/posts',
      )) as { data?: FbPost[] } | null;
      if (!postsJson?.data) return [];

      const out: RawInteraction[] = [];
      for (const post of postsJson.data) {
        const commentsJson = (await safeFetch(
          `${GRAPH_BASE}/${post.id}/comments?fields=id,message,from,created_time&limit=50&access_token=${encodeURIComponent(token)}`,
          `post/${post.id}/comments`,
        )) as { data?: FbComment[] } | null;
        if (!commentsJson?.data) continue;
        for (const c of commentsJson.data) {
          const receivedAt = c.created_time ? new Date(c.created_time) : new Date();
          if (since && receivedAt.getTime() < since.getTime()) continue;
          out.push({
            externalId: `fb_comment_${c.id}`,
            type: 'COMMENT',
            threadId: post.id,
            content: c.message ?? '',
            fromHandle: c.from?.id ?? 'unknown',
            fromName: c.from?.name,
            postExternalId: post.id,
            receivedAt,
            rawData: { source: 'facebook', postId: post.id, raw: c },
          });
        }
      }
      return out;
    } catch (err) {
      logger.warn('Facebook ingestComments failed', { err: (err as Error).message });
      return [];
    }
  },

  /**
   * Mentions on Facebook are surfaced via DM/messenger conversations. We treat
   * each incoming message in /me/conversations as a DM-type interaction.
   */
  async ingestMentions({ token, since }: IngestArgs): Promise<RawInteraction[]> {
    if (!token) return [];
    if (!realMode()) return [];
    try {
      const convJson = (await safeFetch(
        `${GRAPH_BASE}/me/conversations?fields=id,updated_time,messages.limit(20){id,message,from,created_time}&limit=20&access_token=${encodeURIComponent(token)}`,
        'me/conversations',
      )) as { data?: FbConversation[] } | null;
      if (!convJson?.data) return [];

      const out: RawInteraction[] = [];
      for (const conv of convJson.data) {
        const msgs = conv.messages?.data ?? [];
        for (const m of msgs) {
          const receivedAt = m.created_time ? new Date(m.created_time) : new Date();
          if (since && receivedAt.getTime() < since.getTime()) continue;
          out.push({
            externalId: `fb_dm_${m.id}`,
            type: 'DM',
            threadId: conv.id,
            content: m.message ?? '',
            fromHandle: m.from?.id ?? 'unknown',
            fromName: m.from?.name,
            receivedAt,
            rawData: { source: 'facebook', conversationId: conv.id, raw: m },
          });
        }
      }
      return out;
    } catch (err) {
      logger.warn('Facebook ingestMentions failed', { err: (err as Error).message });
      return [];
    }
  },
};
