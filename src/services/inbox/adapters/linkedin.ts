/**
 * LinkedIn inbox adapter — fetches comments on org posts via Marketing
 * Developer Platform.
 *
 * LinkedIn is restrictive: the /socialActions/{post}/comments endpoint
 * requires the r_organization_social scope and a Marketing Developer Platform
 * approval. We do NOT throw on failure — we log a warning and return [] so
 * the rest of the inbox pipeline keeps moving.
 *
 * DMs (Conversations API) require LinkedIn Messaging API access which is
 * essentially unavailable; we explicitly return [] for ingestMentions.
 */
import { logger } from '@/lib/logger';
import type { IngestArgs, RawInteraction } from './types';

const LI_BASE = 'https://api.linkedin.com/v2';

function realMode(): boolean {
  return process.env.ENABLE_REAL_PUBLISHING === 'true';
}

interface LiSocialAction {
  $URN?: string;
  actor?: string;
  message?: { text?: string };
  created?: { time?: number };
  id?: string;
}

export const linkedinInboxAdapter = {
  platform: 'LINKEDIN' as const,

  async ingestComments({ socialAccount, token, since }: IngestArgs): Promise<RawInteraction[]> {
    if (!token) {
      logger.warn('LinkedIn ingestComments: no token, skipping');
      return [];
    }
    if (!realMode()) return [];

    // We expect the SocialAccount.metadata to optionally carry recent post URNs
    // to scan. Without them, LinkedIn does not offer a cheap "list all posts"
    // call for the authed user the way Meta does.
    const meta = (socialAccount.metadata ?? {}) as Record<string, unknown>;
    const urns = Array.isArray(meta.recentPostUrns) ? (meta.recentPostUrns as string[]) : [];
    if (urns.length === 0) {
      logger.warn('LinkedIn ingestComments: no recentPostUrns in metadata — skipping');
      return [];
    }

    const out: RawInteraction[] = [];
    for (const urn of urns) {
      try {
        const url = `${LI_BASE}/socialActions/${encodeURIComponent(urn)}/comments`;
        const res = await fetch(url, {
          headers: {
            authorization: `Bearer ${token}`,
            'x-restli-protocol-version': '2.0.0',
          },
        });
        if (!res.ok) {
          logger.warn('LinkedIn comments non-2xx', { urn, status: res.status });
          continue;
        }
        const json = (await res.json()) as { elements?: LiSocialAction[] };
        if (!json.elements) continue;
        for (const c of json.elements) {
          const tsMs = c.created?.time ?? Date.now();
          const receivedAt = new Date(tsMs);
          if (since && receivedAt.getTime() < since.getTime()) continue;
          const externalId = c.id ?? c.$URN ?? `${urn}:${tsMs}`;
          out.push({
            externalId: `li_comment_${externalId}`,
            type: 'COMMENT',
            threadId: urn,
            content: c.message?.text ?? '',
            fromHandle: c.actor ?? 'unknown',
            postExternalId: urn,
            receivedAt,
            rawData: { source: 'linkedin', postUrn: urn, raw: c },
          });
        }
      } catch (err) {
        logger.warn('LinkedIn ingestComments error', { urn, err: (err as Error).message });
      }
    }
    return out;
  },

  /**
   * LinkedIn Messaging API is gated; we return [] and log so this is visible
   * but not fatal.
   */
  async ingestMentions(_args: IngestArgs): Promise<RawInteraction[]> {
    logger.warn('LinkedIn ingestMentions: Messaging API not available, skipping');
    return [];
  },
};
