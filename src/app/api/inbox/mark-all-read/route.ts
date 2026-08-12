import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

/** POST /api/inbox/mark-all-read — marque lues toutes les interactions NEW (même scope que le badge). */
export const POST = handle(async () => {
  const ctx = await requireTenant();
  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const result = await db.socialInteraction.updateMany({
    where: {
      organizationId: ctx.organizationId,
      status: 'NEW' as never,
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
    },
    data: { status: 'READ' as never },
  });
  return ok({ marked: result.count });
});
