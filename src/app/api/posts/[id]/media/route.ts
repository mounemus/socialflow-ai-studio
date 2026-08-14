import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { syncPostToStrategyItem } from '@/lib/post-item-sync';

export const dynamic = 'force-dynamic';

const schema = z.object({
  mediaId: z.string(),
  /** Remplace les visuels déjà attachés au lieu de s'y ajouter. */
  replace: z.boolean().default(true),
});

/**
 * POST /api/posts/[id]/media { mediaId, replace? } — rattache un visuel déjà
 * généré (Studio → onglet Visuel) à la publication de travail.
 *
 * Sans cette route, le Studio produisait des images qui n'étaient liées à
 * AUCUNE publication : le travail fait dans l'onglet Visuel était perdu au
 * moment de publier.
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  const body = schema.parse(await req.json());

  const asset = await db.mediaAsset.findFirst({
    where: { id: body.mediaId, organizationId },
    select: { id: true, url: true },
  });
  if (!asset) throw new NotFoundError('Media not found in this organization');

  if (body.replace) {
    // Détache les visuels précédents — un post ne part qu'avec ce qu'on voit.
    const previous = await db.mediaAsset.findMany({
      where: { posts: { some: { id } }, NOT: { id: asset.id } },
      select: { id: true },
    });
    if (previous.length > 0) {
      await db.post.update({
        where: { id },
        data: { media: { disconnect: previous.map((p) => ({ id: p.id })) } },
      });
    }
  }

  await db.post.update({
    where: { id },
    data: { media: { connect: { id: asset.id } } },
  });

  // Reflète le nouveau visuel sur l'item de stratégie lié (Actes 4/5).
  await syncPostToStrategyItem(id);

  return ok({ attached: asset.id, url: asset.url });
});

const detachSchema = z.object({ mediaId: z.string() });

/** DELETE /api/posts/[id]/media { mediaId } — détache un visuel du post (le MediaAsset reste en bibliothèque). */
export const DELETE = handle(async (req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  const body = detachSchema.parse(await req.json());

  await db.post.update({
    where: { id },
    data: { media: { disconnect: { id: body.mediaId } } },
  });

  // Couverture nettoyée si elle pointait sur le média détaché — sinon la
  // publication continuait d'envoyer un visuel que l'aperçu ne montrait plus.
  const post = await db.post.findUnique({ where: { id }, select: { metadata: true } });
  const meta = (post?.metadata as Record<string, unknown> | null) ?? {};
  if (meta.coverMediaId === body.mediaId) {
    const { coverMediaId: _c, coverUrl: _u, ...rest } = meta;
    await db.post.update({ where: { id }, data: { metadata: rest as never } }).catch(() => undefined);
  }

  await syncPostToStrategyItem(id);

  return ok({ detached: body.mediaId });
});
