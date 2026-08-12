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
      maxTokens: 4096,
    });

    if (!sources.length) return [];

    // Étape 2 — résumé PAR SOURCE : le texte groundé est un blob markdown
    // partagé ; sans cette étape chaque mention affichait le même pavé et le
    // score de pertinence ne voulait rien dire.
    const perSite = await summarizePerSource(text, sources.map((s) => s.title));

    const out: RawMention[] = [];
    const seen = new Set<string>();
    for (const s of sources) {
      if (!s.uri || seen.has(s.uri)) continue;
      seen.add(s.uri);
      const site = cleanMarkdown(s.title || '');
      const summary = perSite.get(site.toLowerCase());
      out.push({
        source: 'WEB',
        externalId: s.uri,
        url: s.uri,
        title: site || s.uri,
        // Les URLs de grounding sont des redirections vertexaisearch — le titre
        // du chunk porte le vrai domaine, l'hôte de l'URL ne veut rien dire.
        authorName: site || hostOf(s.uri),
        content: summary || cleanMarkdown(text).slice(0, 500) || site || s.uri,
        language: opts.language,
      });
    }
    return out;
  } catch (err) {
    logger.warn('web.search failed', { err: (err as Error).message, watchId: opts.watchId });
    return [];
  }
}

/** Retire le markdown (##, **, …) — les mentions sont du texte brut à l'écran. */
function cleanMarkdown(s: string): string {
  return s.replace(/[#*_`>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Associe à chaque source (par son titre/domaine) un résumé propre de 1-2 phrases. */
async function summarizePerSource(report: string, siteTitles: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const sites = [...new Set(siteTitles.filter(Boolean))];
  if (!report.trim() || sites.length === 0) return map;
  try {
    const { text } = await GeminiService.generateText({
      prompt: `Rapport de veille :\n${report}\n\nSources : ${sites.join(', ')}`,
      systemInstruction:
        `Pour CHAQUE source listée, extrais du rapport un résumé d'1-2 phrases en français, texte brut sans markdown, ` +
        `décrivant ce que cette source dit précisément. Si le rapport ne dit rien de spécifique sur une source, omets-la. ` +
        `Réponds UNIQUEMENT en JSON strict : {"items": [{"site": "titre exact de la source", "summary": "..."}]}`,
      temperature: 0.2,
      maxTokens: 2048,
      json: true,
    });
    const parsed = JSON.parse(text) as { items?: Array<{ site?: string; summary?: string }> };
    for (const it of parsed.items ?? []) {
      if (it.site && it.summary?.trim()) map.set(it.site.trim().toLowerCase(), it.summary.trim());
    }
  } catch (err) {
    logger.warn('web.summarizePerSource failed — fallback blob partagé', { err: (err as Error).message });
  }
  return map;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
