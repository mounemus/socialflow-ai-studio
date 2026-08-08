import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { sanitizeSocialText } from '@/lib/social-text';

/**
 * POST   /api/posts/[id]/variants/[variantId] — appliquer la variante au post
 *        (l'état courant est snapshotté en PostVersion avant écrasement)
 * DELETE /api/posts/[id]/variants/[variantId] — supprimer la variante
 */
export const POST = handle(async (_req, { params }) => {
  const { id, variantId } = await params;
  const { role, userId, post } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');

  const variant = await db.postVariant.findFirst({ where: { id: variantId, postId: id } });
  if (!variant) throw new NotFoundError('Variante introuvable');

  await db.postVersion.upsert({
    where: { postId_version: { postId: id, version: post.version } },
    create: {
      postId: id,
      version: post.version,
      title: post.title,
      body: post.body,
      hashtags: post.hashtags,
      cta: post.cta,
      note: `avant application variante ${variant.label}`,
      createdById: userId,
    },
    update: {},
  });

  const updated = await db.post.update({
    where: { id },
    data: {
      // Nettoie aussi les variantes historiques polluées par du markdown.
      body: sanitizeSocialText(variant.body ?? ''),
      hashtags: variant.hashtags,
      cta: variant.cta,
      version: { increment: 1 },
    },
  });
  return ok({ applied: variant.label, post: updated });
});

export const DELETE = handle(async (_req, { params }) => {
  const { id, variantId } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  await db.postVariant.deleteMany({ where: { id: variantId, postId: id } });
  return ok({ deleted: true });
});
