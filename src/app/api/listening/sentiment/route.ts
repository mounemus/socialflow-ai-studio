import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

/**
 * GET /api/listening/sentiment
 * Sentiment breakdown + daily timeseries for charts.
 * Query: brandId?, days (default 30). Multi-tenant safe (scoped to org).
 */
const querySchema = z.object({
  brandId: z.string().optional(),
  days: z.coerce.number().int().positive().max(365).default(30),
});

type SentimentKey = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'SPAM' | 'UNKNOWN';
const SENTIMENTS: SentimentKey[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'SPAM', 'UNKNOWN'];

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const q = querySchema.parse({
    brandId: url.searchParams.get('brandId') ?? undefined,
    days: url.searchParams.get('days') ?? undefined,
  });

  const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);

  const where: Prisma.BrandMentionWhereInput = {
    organizationId: ctx.organizationId,
    publishedAt: { gte: since },
    ...(q.brandId ? { brandId: q.brandId } : {}),
  };

  // ---- Breakdown (counts + avg score per sentiment) -----------------------
  const grouped = await db.brandMention.groupBy({
    by: ['sentiment'],
    where,
    _count: { _all: true },
    _avg: { sentimentScore: true },
  });

  const breakdown = SENTIMENTS.map((s) => {
    const row = grouped.find((g) => g.sentiment === s);
    return {
      sentiment: s,
      count: row?._count._all ?? 0,
      avgScore: row?._avg.sentimentScore ?? null,
    };
  });
  const total = breakdown.reduce((acc, b) => acc + b.count, 0);

  // ---- Timeseries (per day, per sentiment) --------------------------------
  // Grouped in SQL by truncated day; org/brand/date filters are parameterised.
  const rows = await db.$queryRaw<
    Array<{ day: Date; sentiment: string; count: bigint }>
  >`
    SELECT date_trunc('day', COALESCE("publishedAt", "createdAt")) AS day,
           "sentiment"::text AS sentiment,
           COUNT(*)::bigint AS count
    FROM "BrandMention"
    WHERE "organizationId" = ${ctx.organizationId}
      AND COALESCE("publishedAt", "createdAt") >= ${since}
      ${q.brandId ? Prisma.sql`AND "brandId" = ${q.brandId}` : Prisma.empty}
    GROUP BY day, "sentiment"
    ORDER BY day ASC
  `;

  // Pivot into one bucket per day with a column per sentiment.
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const key = r.day.toISOString().slice(0, 10);
    const bucket =
      byDay.get(key) ??
      (() => {
        const init: Record<string, number> = { total: 0 };
        for (const s of SENTIMENTS) init[s] = 0;
        return init;
      })();
    const n = Number(r.count);
    const s = r.sentiment.toUpperCase();
    if (s in bucket) bucket[s] += n;
    bucket.total += n;
    byDay.set(key, bucket);
  }

  const timeseries = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, counts]) => ({ date, ...counts }));

  return ok({ breakdown, total, timeseries, days: q.days });
});
