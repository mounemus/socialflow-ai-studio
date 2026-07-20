/**
 * SentimentService — batch sentiment classification for social interactions.
 *
 * Uses AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', ...) with a
 * compact JSON-only prompt. Batches up to BATCH_SIZE items per AI call to save
 * tokens.
 *
 * Failure modes return UNKNOWN for every input so the caller can safely persist
 * the result without losing the row.
 */
import { logger } from '@/lib/logger';
import { AIRouterService } from '@/services/ai/AIRouterService';

export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'SPAM' | 'UNKNOWN';

const VALID: Set<Sentiment> = new Set(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'SPAM', 'UNKNOWN']);

const BATCH_SIZE = 20;

export interface SentimentItem {
  id: string;
  content: string;
}

export interface SentimentResult {
  id: string;
  sentiment: Sentiment;
  score?: number;
}

export const SentimentService = {
  /**
   * Classify N social comments. Always returns an array the same length as the
   * input — failures map to UNKNOWN, never throws.
   *
   * The AI is asked for a -1..1 score:
   *   -1.0  =>  strongly negative
   *    0.0  =>  neutral
   *   +1.0  =>  strongly positive
   *   SPAM/UNKNOWN get score 0.
   */
  async classifyBatch(items: SentimentItem[]): Promise<SentimentResult[]> {
    if (items.length === 0) return [];

    const out: SentimentResult[] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const slice = items.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const part = await classifySlice(slice);
      out.push(...part);
    }
    return out;
  },
};

async function classifySlice(items: SentimentItem[]): Promise<SentimentResult[]> {
  const prompt = [
    'You classify social media comments. For each item below, output a JSON object with:',
    '  "id"        – the input id verbatim',
    '  "sentiment" – one of "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "SPAM"',
    '  "score"     – number between -1 and 1 (negative=hostile, 0=neutral, positive=warm)',
    '',
    'Return ONLY a JSON array of those objects, no prose, no markdown fences.',
    '',
    'Items:',
    ...items.map((it) => `id=${it.id} :: ${it.content.replace(/\n/g, ' ').slice(0, 500)}`),
  ].join('\n');

  try {
    const r = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', { prompt });
    const parsed = parseSentimentResponse(r.text ?? '');
    if (parsed.length === 0 || r.mocked) {
      return items.map((it) => ({ id: it.id, sentiment: 'UNKNOWN' as const, score: 0 }));
    }
    const byId = new Map(parsed.map((p) => [p.id, p]));
    return items.map(
      (it) => byId.get(it.id) ?? { id: it.id, sentiment: 'UNKNOWN' as const, score: 0 },
    );
  } catch (err) {
    logger.warn('SentimentService.classifySlice failed', {
      err: (err as Error).message,
      count: items.length,
    });
    return items.map((it) => ({ id: it.id, sentiment: 'UNKNOWN' as const, score: 0 }));
  }
}

function parseSentimentResponse(text: string): SentimentResult[] {
  // Find first JSON array in the text. Model occasionally wraps with prose or
  // markdown fences despite the instruction — we recover gracefully.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = text.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice) as Array<{ id?: string; sentiment?: string; score?: number }>;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => typeof r.id === 'string')
      .map((r) => {
        const s = String(r.sentiment ?? 'UNKNOWN').toUpperCase() as Sentiment;
        const score = typeof r.score === 'number'
          ? Math.max(-1, Math.min(1, r.score))
          : undefined;
        return {
          id: r.id as string,
          sentiment: VALID.has(s) ? s : ('UNKNOWN' as const),
          score,
        };
      });
  } catch (err) {
    logger.warn('SentimentService: parsing de la réponse IA échoué', {
      err: (err as Error).message,
    });
    return [];
  }
}
