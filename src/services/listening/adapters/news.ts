/**
 * News source adapter — REAL.
 *
 * Uses Google News RSS search (no auth):
 *   https://news.google.com/rss/search?q=<query>&hl=<lang>
 *
 * We parse the XML <item> nodes with plain string/regex parsing (no XML lib):
 *   <title>, <link>, <pubDate>, <description>, <source>.
 *
 * externalId = link, source='NEWS'. Defensive: returns [] on any failure.
 */
import { logger } from '@/lib/logger';
import type { RawMention, SearchOpts } from './types';

const RSS_BASE = 'https://news.google.com/rss/search';
const USER_AGENT = 'socialflow-ai/1.0';

function buildQuery(keywords: string[]): string {
  // Quote multi-word terms, OR them together.
  return keywords.map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' OR ');
}

/** Extract the inner text of the first <tag>…</tag>, handling CDATA + entities. */
function pickTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  return decodeEntities(stripCdata(m[1])).trim() || undefined;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export async function search(keywords: string[], opts: SearchOpts = {}): Promise<RawMention[]> {
  const terms = keywords.filter((k) => k && k.trim());
  if (terms.length === 0) return [];

  const lang = opts.language ?? 'fr';
  const url =
    `${RSS_BASE}?q=${encodeURIComponent(buildQuery(terms))}` +
    `&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(lang.toUpperCase())}&ceid=${encodeURIComponent(`${lang.toUpperCase()}:${lang}`)}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, accept: 'application/rss+xml, text/xml' } });
    if (!res.ok) {
      logger.warn('news.search non-2xx', { status: res.status, watchId: opts.watchId });
      return [];
    }
    const xml = await res.text();
    const limit = opts.limit ?? 25;

    const items = xml.split(/<item>/i).slice(1); // drop channel header
    const out: RawMention[] = [];
    for (const raw of items) {
      const block = raw.split(/<\/item>/i)[0] ?? raw;
      const link = pickTag(block, 'link');
      if (!link) continue;

      const title = pickTag(block, 'title');
      const descRaw = pickTag(block, 'description');
      const description = descRaw ? stripTags(decodeEntities(descRaw)) : undefined;
      const pubDate = pickTag(block, 'pubDate');
      const source = pickTag(block, 'source');
      const published = pubDate ? Date.parse(pubDate) : NaN;

      out.push({
        source: 'NEWS',
        externalId: link,
        url: link,
        title,
        authorName: source,
        content: description || title || link,
        language: lang,
        publishedAt: Number.isNaN(published) ? undefined : published,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    logger.warn('news.search failed', { err: (err as Error).message, watchId: opts.watchId });
    return [];
  }
}
