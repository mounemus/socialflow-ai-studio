import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  brandId: z.string().optional(),
  platform: z.string().optional(),
  status: z.string().optional(),
});

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const filters = querySchema.parse({
    from: url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString(),
    to: url.searchParams.get('to') ?? new Date(Date.now() + 60 * 86_400_000).toISOString(),
    brandId: url.searchParams.get('brandId') ?? undefined,
    platform: url.searchParams.get('platform') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  });

  const schedules = await db.postSchedule.findMany({
    where: {
      post: {
        organizationId: ctx.organizationId,
        ...(filters.brandId ? { brandId: filters.brandId } : {}),
      },
      scheduledFor: {
        gte: new Date(filters.from),
        lte: new Date(filters.to),
      },
      ...(filters.platform ? { socialAccount: { platform: filters.platform as never } } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    include: {
      post: {
        select: {
          id: true, title: true, body: true, format: true, status: true,
          brand: { select: { id: true, name: true } },
        },
      },
      socialAccount: { select: { id: true, platform: true, handle: true } },
    },
    orderBy: { scheduledFor: 'asc' },
  });

  return ok({
    schedules: schedules.map((s) => ({
      id: s.id,
      scheduledFor: s.scheduledFor.toISOString(),
      status: s.status,
      postId: s.post.id,
      postTitle: s.post.title ?? (s.post.body ?? '').slice(0, 80) ?? 'Sans titre',
      postFormat: s.post.format,
      brandId: s.post.brand?.id ?? null,
      brandName: s.post.brand?.name ?? null,
      platform: s.socialAccount?.platform ?? 'MANUAL',
      handle: s.socialAccount?.handle ?? '',
      shareMode: s.shareMode ?? 'AUTO',
      manualSharedAt: s.manualSharedAt?.toISOString() ?? null,
    })),
    count: schedules.length,
  });
});
