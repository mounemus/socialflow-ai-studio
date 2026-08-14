import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Write-through Post → StrategyItem.
 *
 * Le Post est la SOURCE DE VÉRITÉ du contenu publiable (texte, hashtags, cta,
 * visuels) : c'est lui qui part à la publication. L'item de stratégie garde
 * une copie de travail dans `metadata.concretization`, lue par les Actes 4/5
 * du pipeline. Sans cette synchro, une édition faite dans le Studio (PATCH
 * post, attache de média) restait invisible dans le pipeline — l'utilisateur
 * validait et publiait un contenu qu'il n'avait jamais relu.
 *
 * Ne jette JAMAIS : la synchro est un effet secondaire best-effort d'une
 * écriture Post déjà réussie.
 */
export async function syncPostToStrategyItem(postId: string): Promise<void> {
  try {
    const post = await db.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        body: true,
        hashtags: true,
        cta: true,
        metadata: true,
        media: { select: { id: true, url: true, kind: true, createdAt: true } },
      },
    });
    if (!post) return;

    const item = await db.strategyItem.findFirst({
      where: { postId },
      select: { id: true, metadata: true },
    });
    if (!item) return;

    const meta = (item.metadata as Record<string, unknown> | null) ?? {};
    const conc = (meta.concretization as Record<string, unknown> | null) ?? {};
    const postMeta = (post.metadata as Record<string, unknown> | null) ?? {};

    // Ordre AUTORITAIRE : metadata.slides (l'éditeur de carrousel), sinon les
    // médias image par date de création. Avant, la collection brute et non
    // ordonnée (jusqu'à 83 générations accumulées) écrasait le carrousel curé.
    const slides = Array.isArray(postMeta.slides)
      ? (postMeta.slides as Array<{ mediaId?: string; url?: string }>)
      : [];
    const byId = new Map((post.media ?? []).map((m) => [m.id, m]));
    let imageUrls: string[] = [];
    if (slides.length > 0) {
      imageUrls = slides
        .map((s) => (s.mediaId ? byId.get(s.mediaId)?.url : null) ?? s.url ?? '')
        .filter((u): u is string => !!u);
    }
    if (imageUrls.length === 0) {
      imageUrls = (post.media ?? [])
        .filter((m) => m.kind === 'IMAGE' && m.url)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, 10)
        .map((m) => m.url);
    }

    // Vidéo : un Reel dont le média est une VIDEO gardait des images périmées
    // côté pipeline et l'URL vidéo n'atteignait jamais l'item.
    const videoUrl =
      (post.media ?? []).find((m) => m.kind === 'VIDEO' && m.url)?.url ?? null;

    const nextConc: Record<string, unknown> = {
      ...conc,
      ...(post.body != null ? { caption: post.body } : {}),
      hashtags: post.hashtags ?? [],
      ...(post.cta != null ? { cta: post.cta } : {}),
      // Les visuels ne sont écrasés que si le post en a — un post au texte
      // édité mais sans média ne doit pas effacer les variantes générées.
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      syncedFromPostAt: new Date().toISOString(),
    };

    await db.strategyItem.update({
      where: { id: item.id },
      data: {
        metadata: {
          ...meta,
          concretization: nextConc,
          ...(post.body != null ? { caption: post.body } : {}),
        } as never,
      },
    });
  } catch (err) {
    logger.warn('syncPostToStrategyItem: synchro Post→item échouée (non bloquant)', {
      postId,
      err: (err as Error).message,
    });
  }
}

/**
 * Un post APPROUVÉ (File de production / demandes de validation) marque
 * l'item de stratégie lié comme « prêt » : le pipeline et la Production
 * partagent la MÊME boucle de validation — approuver ici, c'est marquer prêt
 * là-bas. Best-effort, ne jette jamais.
 */
export async function markLinkedItemReadyFromPost(postId: string): Promise<void> {
  try {
    // Contenu à jour d'abord (caption/visuels du post approuvé).
    await syncPostToStrategyItem(postId);
    const item = await db.strategyItem.findFirst({
      where: { postId },
      select: { id: true, metadata: true },
    });
    if (!item) return;
    const meta = (item.metadata as Record<string, unknown> | null) ?? {};
    const conc = (meta.concretization as Record<string, unknown> | null) ?? {};
    if (conc.status === 'ready') return; // déjà prêt — idempotent
    const readyAt = new Date().toISOString();
    await db.strategyItem.update({
      where: { id: item.id },
      data: {
        metadata: {
          ...meta,
          concretization: { ...conc, status: 'ready', readyAt },
          status: 'ready',
          readyAt,
        } as never,
      },
    });
  } catch (err) {
    logger.warn('markLinkedItemReadyFromPost: write-through échoué (non bloquant)', {
      postId,
      err: (err as Error).message,
    });
  }
}
