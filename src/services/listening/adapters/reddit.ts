/**
 * Reddit source adapter — REAL.
 *
 * Uses Reddit's public JSON search (no auth required):
 *   https://www.reddit.com/search.json?q=<query>&sort=new&limit=25
 *
 * A 'User-Agent' header is required by Reddit; without it requests are throttled
 * or 429'd. Defensive contract: returns [] on any failure.
 */
import { logger } from '@/lib/logger';
import type { RawMention, SearchOpts } from './types';

const SEARCH_BASE = 'https://www.reddit.com/search.json';
const USER_AGENT = 'socialflow-ai/1.0';

interface RedditChildData {
  id?: string;
  name?: string;
  permalink?: string;
  title?: string;
  selftext?: string;
  author?: string;
  ups?: number;
  num_comments?: number;
  subreddit?: string;
  subreddit_subscribers?: number;
  created_utc?: number;
}

interface RedditListing {
  data?: { children?: Array<{ data?: RedditChildData }> };
}

/**
 * Build an OR query across keywords. Reddit search supports quoted phrases and
 * boolean OR, e.g.  "acme corp" OR acme
 */
function buildQuery(keywords: string[]): string {
  return keywords
    .map((k) => (k.includes(' ') ? `"${k}"` : k))
    .join(' OR ');
}

export async function search(keywords: string[], opts: SearchOpts = {}): Promise<RawMention[]> {
  const terms = keywords.filter((k) => k && k.trim());
  if (terms.length === 0) return [];

  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(buildQuery(terms))}&sort=new&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, accept: 'application/json' },
    });
    if (!res.ok) {
      logger.warn('reddit.search non-2xx', { status: res.status, watchId: opts.watchId });
      return [];
    }
    const json = (await res.json()) as RedditListing;
    const children = json.data?.children ?? [];
    const out: RawMention[] = [];

    for (const child of children) {
      const d = child.data;
      if (!d) continue;
      const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : undefined;
      const externalId = d.permalink ?? d.name ?? (d.id ? `t3_${d.id}` : '');
      if (!externalId) continue;

      const content = (d.selftext && d.selftext.trim()) || d.title || '';
      out.push({
        source: 'REDDIT',
        externalId,
        url: permalink,
        authorHandle: d.author,
        authorName: d.author,
        title: d.title,
        content,
        reach: d.subreddit_subscribers,
        engagementCount: (d.ups ?? 0) + (d.num_comments ?? 0),
        publishedAt: d.created_utc ? d.created_utc * 1000 : undefined,
        language: opts.language,
      });
    }
    return out;
  } catch (err) {
    logger.warn('reddit.search failed', { err: (err as Error).message, watchId: opts.watchId });
    return [];
  }
}
