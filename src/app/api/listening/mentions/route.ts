import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

/**
 * GET /api/listening/mentions
 * List BrandMention rows for the active org. Multi-tenant safe (scoped to
 * ctx.organizationId via requireTenant).
 *
 * Query filters: source, sentiment, status, watchId, brandId, search, days.
 */
const querySchema = z.object({
  source: z.string().optional(),
  sentiment: z.string().optional(),
  status: z.string().optional(),
  watchId: z.string().optional(),
  brandId: z.string().optional(),
  search: z.string().optional(),
  days: z.coerce.number().int().positive().max(365).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const q = querySchema.parse({
    source: url.searchParams.get('source') ?? undefined,
    sentiment: url.searchParams.get('sentiment') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    watchId: url.searchParams.get('watchId') ?? undefined,
    brandId: url.searchParams.get('brandId') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    days: url.searchParams.get('days') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });

  const since = q.days ? new Date(Date.now() - q.days * 24 * 60 * 60 * 1000) : undefined;

  const where: Prisma.BrandMentionWhereInput = {
    organizationId: ctx.organizationId,
    ...(q.source ? { source: q.source as never } : {}),
    ...(q.sentiment ? { sentiment: q.sentiment as never } : {}),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.watchId ? { watchId: q.watchId } : {}),
    ...(q.brandId ? { brandId: q.brandId } : {}),
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...(q.search
      ? {
          OR: [
            { content: { contains: q.search, mode: 'insensitive' } },
            { title: { contains: q.search, mode: 'insensitive' } },
            { authorHandle: { contains: q.search, mode: 'insensitive' } },
            { authorName: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [mentions, total, unreviewed] = await Promise.all([
    db.brandMention.findMany({
      where,
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        watch: { select: { id: true, name: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: q.limit,
      skip: q.offset,
    }),
    db.brandMention.count({ where }),
    db.brandMention.count({
      where: { organizationId: ctx.organizationId, status: 'NEW' as never },
    }),
  ]);

  return ok({ mentions, total, unreviewed });
});
