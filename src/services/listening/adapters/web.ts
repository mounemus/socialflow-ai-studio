/**
 * Web source adapter — uses GeminiService.groundedResearch (Google Search
 * grounding) to surface recent web mentions + citations for a set of keywords.
 *
 * Each citation becomes a RawMention (externalId = citation url, source='WEB').
 * The grounded answer text is used as a shared snippet/content for the citations
 * (Gemini does not return per-citation snippets), trimmed for storage.
 *
 * If Gemini is not configured, returns [] (no mock rows). Defensive: [] on error.
 */
import { logger } from '@/lib/logger';
import { GeminiService } from '@/services/ai/GeminiService';
import type { RawMention, SearchOpts } from './types';

export async function search(keywords: string[], opts: SearchOpts = {}): Promise<RawMention[]> {
  const terms = keywords.filter((k) => k && k.trim());
  if (terms.length === 0) return [];
  if (!GeminiService.isConfigured()) return [];

  const joined = terms.join(', ');
  const query =
    `mentions récentes de ${joined} avis opinion réputation. ` +
    `Liste les pages et articles où ${joined} est mentionné récemment, ` +
    `avec un bref résumé du ton (positif / négatif / neutre).`;

  try {
    const { text, sources } = await GeminiService.groundedResearch({
      query,
      maxResults: opts.limit ?? 15,
    });

    if (!sources.length) return [];
    const snippet = (text || '').trim().slice(0, 1000);

    const out: RawMention[] = [];
    const seen = new Set<string>();
    for (const s of sources) {
      if (!s.uri || seen.has(s.uri)) continue;
      seen.add(s.uri);
      out.push({
        source: 'WEB',
        externalId: s.uri,
        url: s.uri,
        title: s.title || s.uri,
        authorName: hostOf(s.uri),
        content: snippet || s.title || s.uri,
        language: opts.language,
      });
    }
    return out;
  } catch (err) {
    logger.warn('web.search failed', { err: (err as Error).message, watchId: opts.watchId });
    return [];
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
