/**
 * AIReliabilityService — compute live reliability metrics for each provider
 * from the AIRequest audit table.
 *
 * Metrics per provider:
 *   - total requests (last 7 days)
 *   - success rate
 *   - p50 / p95 / p99 latency
 *   - tokens consumed
 *   - estimated cost (USD)
 *   - last error timestamp + message
 */
import { db } from '@/lib/db';

// Prices per million tokens (Anthropic/OpenAI/Google as of 2026)
// Source: provider pricing pages — approximate, used for cost estimation only.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  anthropic: { input: 3, output: 15 },        // Claude Sonnet 4.6
  openai: { input: 0.15, output: 0.6 },        // GPT-4o-mini
  gemini: { input: 0.075, output: 0.3 },       // Gemini 2.5 Flash
  'gemini-grounded': { input: 0.15, output: 0.6 },
  mock: { input: 0, output: 0 },
};

const COST_PER_IMAGE: Record<string, number> = {
  replicate: 0.003,  // FLUX schnell
  stability: 0.04,   // SDXL
  openai: 0.04,      // DALL-E 3 hd 1024
  mock: 0,
};

export interface ProviderMetrics {
  provider: string;
  requests: number;
  successRate: number;        // 0-1
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  byHour?: { hour: string; requests: number; failures: number }[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

export const AIReliabilityService = {
  /**
   * Compute metrics for all providers over a time window.
   */
  async getMetrics(organizationId: string | null, windowDays = 7): Promise<ProviderMetrics[]> {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const requests = await db.aIRequest.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        createdAt: { gte: since },
      },
      select: {
        durationMs: true,
        success: true,
        inputTokens: true,
        outputTokens: true,
        errorMessage: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    // Group by provider (from metadata.provider field)
    const byProvider = new Map<string, typeof requests>();
    for (const r of requests) {
      const meta = r.metadata as { provider?: string; mocked?: boolean } | null;
      const provider = meta?.mocked ? 'mock' : meta?.provider ?? 'unknown';
      const arr = byProvider.get(provider) ?? [];
      arr.push(r);
      byProvider.set(provider, arr);
    }

    const result: ProviderMetrics[] = [];
    for (const [provider, list] of byProvider.entries()) {
      const successes = list.filter((r) => r.success);
      const latencies = list
        .map((r) => r.durationMs ?? 0)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const totalIn = list.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
      const totalOut = list.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
      const lastError = list.find((r) => !r.success);

      const prices = PRICE_PER_MTOK[provider] ?? PRICE_PER_MTOK[provider.split('-')[0]] ?? { input: 0, output: 0 };
      const tokensCost = (totalIn / 1_000_000) * prices.input + (totalOut / 1_000_000) * prices.output;
      // Image requests don't have token counts → cost from image count
      const imageCost = provider in COST_PER_IMAGE ? list.length * COST_PER_IMAGE[provider] : 0;

      // Hourly breakdown (24 buckets)
      const byHourMap = new Map<string, { requests: number; failures: number }>();
      for (const r of list) {
        const hour = r.createdAt.toISOString().slice(0, 13); // YYYY-MM-DDTHH
        const cur = byHourMap.get(hour) ?? { requests: 0, failures: 0 };
        cur.requests++;
        if (!r.success) cur.failures++;
        byHourMap.set(hour, cur);
      }

      result.push({
        provider,
        requests: list.length,
        successRate: list.length === 0 ? 1 : successes.length / list.length,
        avgLatencyMs: latencies.length === 0 ? 0 : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        estimatedCostUSD: Math.round((tokensCost + imageCost) * 10000) / 10000,
        lastErrorAt: lastError?.createdAt ?? null,
        lastErrorMessage: lastError?.errorMessage ?? null,
        byHour: Array.from(byHourMap.entries())
          .sort()
          .map(([hour, v]) => ({ hour, ...v }))
          .slice(-24),
      });
    }

    // Sort by total request count desc
    result.sort((a, b) => b.requests - a.requests);
    return result;
  },

  /**
   * Compute a "reliability score" 0-100 per provider combining success rate + latency.
   */
  scoreProvider(m: ProviderMetrics): number {
    if (m.requests === 0) return 100; // no data = neutral
    const successScore = m.successRate * 80; // up to 80 points
    // Latency: <2s = 20pts, 5s = 10pts, 10s+ = 0pts
    const latencyScore = m.p95LatencyMs < 2000 ? 20
      : m.p95LatencyMs < 5000 ? 15
      : m.p95LatencyMs < 10000 ? 10
      : 5;
    return Math.round(successScore + latencyScore);
  },

  /**
   * Aggregate stats across providers.
   */
  async getOverview(organizationId: string | null, windowDays = 7) {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const where = {
      ...(organizationId ? { organizationId } : {}),
      createdAt: { gte: since },
    };
    const [total, success, errors24h] = await Promise.all([
      db.aIRequest.count({ where }),
      db.aIRequest.count({ where: { ...where, success: true } }),
      db.aIRequest.count({
        where: {
          ...(organizationId ? { organizationId } : {}),
          createdAt: { gte: new Date(Date.now() - 86_400_000) },
          success: false,
        },
      }),
    ]);
    return {
      windowDays,
      totalRequests: total,
      successRate: total === 0 ? 1 : success / total,
      errorsLast24h: errors24h,
    };
  },
};
