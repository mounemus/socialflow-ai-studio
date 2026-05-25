import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { MarketingWatchService } from '@/services/watch/MarketingWatchService';

const createSchema = z.object({
  brandId: z.string().optional(),
  kind: z.enum(['TREND', 'KEYWORD', 'HASHTAG', 'RSS', 'COMPETITOR', 'PRODUCT', 'GOOGLE_TRENDS', 'TIKTOK_TRENDS', 'REDDIT', 'YOUTUBE']),
  name: z.string().min(1),
  query: z.string().optional(),
  language: z.string().default('fr'),
  country: z.string().optional(),
  platform: z.string().optional(),
  rssUrl: z.string().url().optional(),
  keywords: z.array(z.string()).optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const watches = await db.trendWatch.findMany({
    where: { organizationId: ctx.organizationId },
    include: { _count: { select: { items: true } }, items: { take: 5, orderBy: { createdAt: 'desc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(watches);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'watch.manage');
  const body = createSchema.parse(await req.json());
  const watch = await db.trendWatch.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      kind: body.kind,
      name: body.name,
      query: body.query,
      language: body.language,
      country: body.country,
      platform: body.platform as never,
      config: { rssUrl: body.rssUrl, keywords: body.keywords ?? [] },
    },
  });
  if (body.kind === 'RSS' && body.rssUrl) {
    // Fire one immediate run (non-blocking would be better — keep sync for MVP).
    await MarketingWatchService.runRssWatch(watch);
  }
  return created(watch);
});
