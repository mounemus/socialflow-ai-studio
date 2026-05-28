import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const brandId = url.searchParams.get('brandId') ?? undefined;
  const strategies = await db.marketingStrategy.findMany({
    where: { organizationId: ctx.organizationId, ...(brandId ? { brandId } : {}) },
    include: {
      brand: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(strategies);
});
