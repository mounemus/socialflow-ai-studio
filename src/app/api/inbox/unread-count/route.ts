import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Lightweight unread-count for the sidebar badge.
 * Static segment → takes precedence over /api/inbox/[id], so it is no longer
 * swallowed by the dynamic route (which previously 404'd with id="unread-count").
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  // Même scope marque que la liste GET /api/inbox — le badge doit être d'accord
  // avec ce que la page affiche.
  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const count = await db.socialInteraction.count({
    where: {
      organizationId: ctx.organizationId,
      status: 'NEW' as never,
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
    },
  });
  return ok({ count });
});
