/**
 * Twitter/X source adapter — OPTIONAL.
 *
 * If process.env.TWITTER_BEARER_TOKEN is present, queries the v2 recent search
 * API; otherwise returns []. source='TWITTER'. Defensive: [] on any failure.
 *
 *   https://api.twitter.com/2/tweets/search/recent
 */
import { logger } from '@/lib/logger';
import type { RawMention, SearchOpts } from './types';

const SEARCH_BASE = 'https://api.twitter.com/2/tweets/search/recent';

function buildQuery(keywords: string[]): string {
  // Recent-search query: OR the terms, quote multi-word phrases, drop retweets.
  const terms = keywords.map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' OR ');
  return `(${terms}) -is:retweet`;
}

interface TweetRow {
  id: string;
  text?: string;
  author_id?: string;
  lang?: string;
  created_at?: string;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
  };
}

interface TwitterUser {
  id: string;
  username?: string;
  name?: string;
  public_metrics?: { followers_count?: number };
}

interface TwitterResponse {
  data?: TweetRow[];
  includes?: { users?: TwitterUser[] };
}

export async function search(keywords: string[], opts: SearchOpts = {}): Promise<RawMention[]> {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];
  const terms = keywords.filter((k) => k && k.trim());
  if (terms.length === 0) return [];

  const max = Math.min(Math.max(opts.limit ?? 25, 10), 100);
  const url =
    `${SEARCH_BASE}?query=${encodeURIComponent(buildQuery(terms))}&max_results=${max}` +
    `&tweet.fields=created_at,author_id,lang,public_metrics` +
    `&expansions=author_id&user.fields=username,name,public_metrics`;

  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      logger.warn('twitter.search non-2xx', { status: res.status, watchId: opts.watchId });
      return [];
    }
    const json = (await res.json()) as TwitterResponse;
    const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
    const out: RawMention[] = [];

    for (const t of json.data ?? []) {
      const u = t.author_id ? users.get(t.author_id) : undefined;
      const m = t.public_metrics;
      out.push({
        source: 'TWITTER',
        externalId: t.id,
        url: `https://twitter.com/i/web/status/${t.id}`,
        authorHandle: u?.username,
        authorName: u?.name,
        content: t.text ?? '',
        reach: u?.public_metrics?.followers_count,
        engagementCount:
          (m?.like_count ?? 0) + (m?.retweet_count ?? 0) + (m?.reply_count ?? 0) + (m?.quote_count ?? 0),
        language: t.lang ?? opts.language,
        publishedAt: t.created_at ? Date.parse(t.created_at) : undefined,
      });
    }
    return out;
  } catch (err) {
    logger.warn('twitter.search failed', { err: (err as Error).message, watchId: opts.watchId });
    return [];
  }
}
