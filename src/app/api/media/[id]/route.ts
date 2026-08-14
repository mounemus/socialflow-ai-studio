import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';
import { syncPostToStrategyItem } from '@/lib/post-item-sync';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/media/[id] — supprime un média de l'organisation, PROPREMENT :
 *  - le fichier Supabase Storage part avec (avant : jamais supprimé, facturé
 *    et publiquement servi à vie) ;
 *  - les couvertures (coverMediaId/coverUrl) des posts qui pointaient dessus
 *    sont nettoyées — sinon la publication continuait d'envoyer l'URL du
 *    visuel que l'utilisateur croyait supprimé, pendant que l'aperçu montrait
 *    autre chose ;
 *  - les items de stratégie liés sont resynchronisés.
 */
export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');

  const asset = await db.mediaAsset.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, url: true, posts: { select: { id: true, metadata: true } } },
  });
  if (!asset) throw new NotFoundError('Media not found in this organization');

  // Couvertures des posts liés qui pointaient sur ce média.
  const affectedPostIds: string[] = [];
  for (const p of asset.posts) {
    const meta = (p.metadata as Record<string, unknown> | null) ?? {};
    if (meta.coverMediaId === id || (typeof meta.coverUrl === 'string' && meta.coverUrl === asset.url)) {
      const { coverMediaId: _c, coverUrl: _u, ...rest } = meta;
      await db.post
        .update({ where: { id: p.id }, data: { metadata: rest as never } })
        .catch(() => undefined);
      affectedPostIds.push(p.id);
    }
  }

  await db.mediaAsset.delete({ where: { id } });

  // Fichier de stockage : best-effort — la ligne DB fait foi, mais on ne
  // laisse pas un fichier « supprimé » servi par le CDN pour toujours.
  const supaUrl = process.env.SUPABASE_URL;
  if (asset.url && supaUrl && SupabaseStorageService.isOurStorageUrl(asset.url)) {
    const path = decodeURIComponent(asset.url.split('/storage/v1/object/public/')[1]?.split('/').slice(1).join('/') ?? '');
    if (path) {
      await SupabaseStorageService.deleteByPath(path).catch((err) =>
        logger.warn('media delete: fichier storage non supprimé', { id, err: (err as Error).message }),
      );
    }
  }

  for (const postId of affectedPostIds) await syncPostToStrategyItem(postId);

  return ok({ deleted: true });
});
