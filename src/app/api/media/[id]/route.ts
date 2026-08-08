import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/media/[id] — supprime un média de l'organisation.
 *
 * Utilisé notamment quand on RÉGÉNÈRE un visuel : sans cela, chaque
 * régénération empilait une image de plus sur le post, et la publication
 * partait avec toutes les versions (2 visuels publiés là où l'aperçu n'en
 * montrait qu'un).
 */
export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');

  const asset = await db.mediaAsset.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!asset) throw new NotFoundError('Media not found in this organization');

  await db.mediaAsset.delete({ where: { id } });
  return ok({ deleted: true });
});
