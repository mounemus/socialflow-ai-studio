/**
 * BulkImportService — bulk content ingestion into DRAFT posts.
 *
 * Two entry points:
 *   - CSV: paste/upload a sheet (title, body, platform, format, hashtags,
 *     scheduledDate, cta) → one DRAFT Post per row.
 *   - RSS/Atom: fetch a feed → one DRAFT Post per item (latest N).
 *
 * No external CSV/XML libraries — small, robust hand-rolled parsers live here.
 * Every created Post carries metadata.importedFrom so the origin is auditable.
 *
 * Mirrors the rest of the codebase: degrades gracefully, never throws on a
 * single bad row (collects errors instead), and always scopes by organizationId.
 */
import type { SupportFormat } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// =================================================================
// TYPES
// =================================================================

export interface CsvRow {
  title?: string;
  body?: string;
  platform?: string;
  format?: string;
  hashtags?: string;
  scheduledDate?: string;
  cta?: string;
  /** any extra columns the sheet had, preserved for metadata */
  [key: string]: string | undefined;
}

export interface ImportFromRowsInput {
  organizationId: string;
  brandId?: string;
  rows: CsvRow[];
}

export interface ImportFromRowsResult {
  created: number;
  skipped: number;
  errors: string[];
}

export interface RssItem {
  title: string;
  summary: string;
  link: string;
  pubDate: string | null;
}

export interface ImportFromRssInput {
  organizationId: string;
  brandId?: string;
  feedUrl: string;
  limit?: number;
  asFormat?: SupportFormat | string;
}

export interface ImportFromRssResult {
  created: number;
  items: RssItem[];
}

// =================================================================
// CONSTANTS / MAPPINGS
// =================================================================

const KNOWN_HEADERS = [
  'title',
  'body',
  'platform',
  'format',
  'hashtags',
  'scheduleddate',
  'cta',
];

const SUPPORT_FORMATS: SupportFormat[] = [
  'INSTAGRAM_POST', 'INSTAGRAM_STORY', 'INSTAGRAM_REEL', 'INSTAGRAM_CAROUSEL',
  'FACEBOOK_POST', 'FACEBOOK_STORY',
  'LINKEDIN_POST', 'LINKEDIN_ARTICLE',
  'TWITTER_POST', 'TWITTER_THREAD',
  'TIKTOK_VIDEO', 'YOUTUBE_SHORT', 'YOUTUBE_THUMBNAIL', 'PINTEREST_PIN',
  'WEB_BANNER', 'AD_VISUAL', 'FLYER', 'POSTER', 'PRESENTATION',
  'EDUCATIONAL_CAROUSEL', 'PRODUCT_SHEET', 'NEWSLETTER', 'EMAIL_MARKETING',
  'LANDING_COPY', 'VIDEO_SCRIPT', 'STORYBOARD', 'VOICEOVER',
  'EDITORIAL_CALENDAR', 'CREATIVE_BRIEF', 'CAMPAIGN_GUIDE', 'MEDIA_KIT', 'PRESS_KIT',
];

const FORMAT_SET = new Set<string>(SUPPORT_FORMATS);

/** platform → default SupportFormat when the row omits a format. */
const PLATFORM_DEFAULT_FORMAT: Record<string, SupportFormat> = {
  INSTAGRAM: 'INSTAGRAM_POST',
  IG: 'INSTAGRAM_POST',
  FACEBOOK: 'FACEBOOK_POST',
  FB: 'FACEBOOK_POST',
  LINKEDIN: 'LINKEDIN_POST',
  TWITTER: 'TWITTER_POST',
  X: 'TWITTER_POST',
  TIKTOK: 'TIKTOK_VIDEO',
  YOUTUBE: 'YOUTUBE_SHORT',
  PINTEREST: 'PINTEREST_PIN',
};

const DEFAULT_FORMAT: SupportFormat = 'INSTAGRAM_POST';

// =================================================================
// CSV PARSER (no external lib)
// =================================================================

/**
 * Parse a single CSV line into fields, honouring RFC-4180-ish quoting:
 *   - fields separated by `,`
 *   - a field may be wrapped in double quotes
 *   - inside quotes, `""` is a literal quote and `,` / newlines are data
 * Note: this operates per-line; embedded newlines inside quotes are not
 * supported (kept intentionally simple — the row splitter is line-based).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Does this row of cells look like a header (matches our known column names)? */
function looksLikeHeader(cells: string[]): boolean {
  const normalized = cells.map((c) => c.toLowerCase().replace(/[\s_-]/g, ''));
  return normalized.some((c) => KNOWN_HEADERS.includes(c));
}

const COLUMN_ALIASES: Record<string, string> = {
  title: 'title',
  body: 'body',
  content: 'body',
  text: 'body',
  caption: 'body',
  platform: 'platform',
  network: 'platform',
  format: 'format',
  type: 'format',
  hashtags: 'hashtags',
  tags: 'hashtags',
  scheduleddate: 'scheduledDate',
  date: 'scheduledDate',
  schedule: 'scheduledDate',
  cta: 'cta',
  calltoaction: 'cta',
};

/** Map an arbitrary header cell to a canonical CsvRow key. */
function canonicalKey(header: string): string {
  const norm = header.toLowerCase().replace(/[\s_-]/g, '');
  return COLUMN_ALIASES[norm] ?? header.trim();
}

// =================================================================
// XML / RSS PARSER (no external lib)
// =================================================================

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Strip HTML tags then collapse whitespace — used to seed the post body. */
function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Extract the inner text of the first <tag>…</tag> (or a self-closed href). */
function firstTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

/** Atom <link href="…"/> (or rss <link>…</link>). */
function extractLink(block: string): string {
  const rss = firstTag(block, 'link');
  if (rss && rss.trim()) return decodeEntities(rss);
  // Atom: prefer rel="alternate", else the first link href.
  const hrefs = [...block.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi)];
  const alt = hrefs.find((h) => /rel=["']alternate["']/i.test(h[0]));
  if (alt) return decodeEntities(alt[1]);
  if (hrefs.length) return decodeEntities(hrefs[0][1]);
  return '';
}

function parseFeed(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // RSS uses <item>, Atom uses <entry>. Handle both.
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const blocks = xml.match(blockRe) ?? [];
  for (const block of blocks) {
    const title = firstTag(block, 'title');
    const description =
      firstTag(block, 'description') ??
      firstTag(block, 'summary') ??
      firstTag(block, 'content') ??
      '';
    const pubDate =
      firstTag(block, 'pubDate') ??
      firstTag(block, 'published') ??
      firstTag(block, 'updated') ??
      firstTag(block, 'dc:date');
    items.push({
      title: title ? decodeEntities(title) : '(sans titre)',
      summary: stripHtml(description),
      link: extractLink(block),
      pubDate: pubDate ? decodeEntities(pubDate) : null,
    });
  }
  return items;
}

// =================================================================
// HELPERS
// =================================================================

/** Split a hashtag cell on spaces/commas, normalise to leading-# tokens. */
function splitHashtags(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
}

/** Resolve a row's format: explicit format → platform default → INSTAGRAM_POST. */
function resolveFormat(row: CsvRow): SupportFormat {
  const explicit = String(row.format ?? '').toUpperCase().replace(/[\s-]/g, '_');
  if (FORMAT_SET.has(explicit)) return explicit as SupportFormat;

  const platform = String(row.platform ?? '').toUpperCase().replace(/[\s-]/g, '_');
  if (PLATFORM_DEFAULT_FORMAT[platform]) return PLATFORM_DEFAULT_FORMAT[platform];

  return DEFAULT_FORMAT;
}

/** Coerce an asFormat hint (string or enum) to a valid SupportFormat. */
function coerceFormat(asFormat: SupportFormat | string | undefined, fallback: SupportFormat): SupportFormat {
  const norm = String(asFormat ?? '').toUpperCase().replace(/[\s-]/g, '_');
  return FORMAT_SET.has(norm) ? (norm as SupportFormat) : fallback;
}

function parseDateSafe(raw?: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// =================================================================
// SERVICE
// =================================================================

export const BulkImportService = {
  /**
   * Parse CSV text (with headers) into structured rows.
   * Tolerant: quoted fields, comma-separated, blank lines skipped, header row
   * auto-detected. When no header row is detected the first line is still
   * treated as the header (best effort) so positional sheets still map.
   */
  parseCsv(text: string): CsvRow[] {
    if (!text || !text.trim()) return [];

    // Normalise newlines, drop empty lines and BOM.
    const lines = text
      .replace(/^﻿/, '')
      .split(/\r\n|\r|\n/)
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const firstCells = parseCsvLine(lines[0]);
    const hasHeader = looksLikeHeader(firstCells);
    // When the first row is a recognizable header, map by its names and skip it.
    // Otherwise fall back to the canonical column order so a header-less sheet
    // (title, body, platform, format, hashtags, scheduledDate, cta) still maps,
    // and the first row is treated as data.
    const headers = hasHeader
      ? firstCells.map(canonicalKey)
      : ['title', 'body', 'platform', 'format', 'hashtags', 'scheduledDate', 'cta'];
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const rows: CsvRow[] = [];
    for (const line of dataLines) {
      const cells = parseCsvLine(line);
      // Fully empty row → skip.
      if (cells.every((c) => c === '')) continue;
      const row: CsvRow = {};
      headers.forEach((key, i) => {
        const val = cells[i];
        if (val !== undefined && val !== '') row[key] = val;
      });
      // Skip rows that carry no usable content at all.
      if (!row.title && !row.body) continue;
      rows.push(row);
    }
    return rows;
  },

  /**
   * Create one DRAFT Post per CSV row.
   * - maps platform → default format when format is missing
   * - splits hashtags on space/comma
   * - sets metadata.importedFrom = 'csv'
   * Never throws on a single bad row; collects the error and continues.
   */
  async importFromRows(input: ImportFromRowsInput): Promise<ImportFromRowsResult> {
    const { organizationId, brandId, rows } = input;
    const errors: string[] = [];
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNo = i + 1;
      try {
        const title = (row.title ?? '').trim() || null;
        const body = (row.body ?? '').trim() || null;
        if (!title && !body) {
          skipped++;
          continue;
        }

        const format = resolveFormat(row);
        const hashtags = splitHashtags(row.hashtags);
        const scheduledDate = parseDateSafe(row.scheduledDate);

        await db.post.create({
          data: {
            organizationId,
            brandId: brandId ?? undefined,
            status: 'DRAFT',
            format,
            title,
            body,
            hashtags,
            cta: (row.cta ?? '').trim() || null,
            metadata: {
              importedFrom: 'csv',
              importedAt: new Date().toISOString(),
              ...(row.platform ? { sourcePlatform: row.platform } : {}),
              ...(scheduledDate ? { suggestedScheduledDate: scheduledDate.toISOString() } : {}),
            } as never,
          },
        });
        created++;
      } catch (err) {
        skipped++;
        const message = `Ligne ${lineNo}: ${(err as Error).message}`;
        errors.push(message);
        logger.warn('BulkImportService.importFromRows row failed', { lineNo, err: (err as Error).message });
      }
    }

    return { created, skipped, errors };
  },

  /**
   * Fetch an RSS/Atom feed and parse its items/entries.
   * Returns [{ title, summary, link, pubDate }]. Throws on network/HTTP errors
   * so the caller can surface a clear message.
   */
  async fetchRss(url: string): Promise<RssItem[]> {
    const res = await fetch(url, {
      headers: { 'user-agent': 'SocialFlowAI/1.0 (+rss-import)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      // RSS feeds are external; don't cache aggressively.
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`Flux RSS injoignable (HTTP ${res.status})`);
    }
    const xml = await res.text();
    return parseFeed(xml);
  },

  /**
   * Fetch a feed and create DRAFT posts from the latest N items.
   * title → post title, description → body seed.
   * metadata.importedFrom = 'rss', metadata.sourceUrl = item link.
   */
  async importFromRss(input: ImportFromRssInput): Promise<ImportFromRssResult> {
    const { organizationId, brandId, feedUrl, limit = 10, asFormat = 'INSTAGRAM_POST' } = input;
    const format = coerceFormat(asFormat, DEFAULT_FORMAT);

    const allItems = await this.fetchRss(feedUrl);
    const items = allItems.slice(0, Math.max(0, limit));

    let created = 0;
    for (const item of items) {
      try {
        const pub = parseDateSafe(item.pubDate);
        await db.post.create({
          data: {
            organizationId,
            brandId: brandId ?? undefined,
            status: 'DRAFT',
            format,
            title: item.title || null,
            body: item.summary || null,
            metadata: {
              importedFrom: 'rss',
              importedAt: new Date().toISOString(),
              sourceUrl: item.link || feedUrl,
              feedUrl,
              ...(pub ? { sourcePublishedAt: pub.toISOString() } : {}),
            } as never,
          },
        });
        created++;
      } catch (err) {
        logger.warn('BulkImportService.importFromRss item failed', {
          link: item.link,
          err: (err as Error).message,
        });
      }
    }

    return { created, items };
  },
};

export type BulkImportServiceType = typeof BulkImportService;
