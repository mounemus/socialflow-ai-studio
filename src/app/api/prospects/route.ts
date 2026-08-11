import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

const STATUSES = ['NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'DISCARDED'] as const;

/** GET /api/prospects — prospects de l'org (scopés marque active), filtrables par ?status=. */
export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const statusParam = new URL(req.url).searchParams.get('status');
  const status = STATUSES.includes(statusParam as never) ? (statusParam as typeof STATUSES[number]) : undefined;

  const items = await db.prospect.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return ok({ items });
});
