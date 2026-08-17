/**
 * État de PUBLICATION des items d'un pipeline — source unique lue par l'Acte 4
 * (« Produire & publier ») et l'Acte 5 (suivi) : statut réel du post lié,
 * dernier créneau, destination résolue (compte / passerelle / manuel).
 *
 * Le pipeline ne stocke rien de tout ça : le Post est la vérité, on la dérive
 * à chaque lecture (payload initial + polling).
 */
import { db } from '@/lib/db';
import { describeDestination, resolvePublishTarget, type DestinationView } from '@/lib/publish-target';

export interface ItemPublicationView {
  itemId: string;
  postId: string | null;
  post: {
    status: string;
    scheduledFor: string | null;
    publishedAt: string | null;
    externalPostId: string | null;
    scheduleStatus: string | null;
    shareMode: string | null;
    errorMessage: string | null;
  } | null;
  destination: DestinationView | null;
}

export type PublicationMap = Record<string, ItemPublicationView>;

export async function buildPublicationMap(
  items: Array<{ id: string; postId: string | null; platform: string | null }>,
  organizationId: string,
): Promise<PublicationMap> {
  const out: PublicationMap = {};
  const postIds = items.map((i) => i.postId).filter((x): x is string => !!x);
  const posts = postIds.length
    ? await db.post.findMany({
        where: { id: { in: postIds }, organizationId },
        include: { schedules: { orderBy: { scheduledFor: 'desc' }, take: 1 } },
      })
    : [];
  const byId = new Map(posts.map((p) => [p.id, p]));

  for (const item of items) {
    const post = item.postId ? byId.get(item.postId) : undefined;
    let destination: DestinationView | null = null;
    if (post) {
      try {
        destination = describeDestination(
          await resolvePublishTarget(post, organizationId, { platform: item.platform }),
        );
      } catch {
        destination = null;
      }
    }
    const sched = post?.schedules[0];
    out[item.id] = {
      itemId: item.id,
      postId: item.postId,
      post: post
        ? {
            status: post.status,
            scheduledFor: sched?.scheduledFor?.toISOString() ?? null,
            publishedAt: sched?.publishedAt?.toISOString() ?? null,
            externalPostId: sched?.externalPostId ?? null,
            scheduleStatus: sched?.status ?? null,
            shareMode: sched?.shareMode ?? null,
            errorMessage: sched?.errorMessage ?? null,
          }
        : null,
      destination,
    };
  }
  return out;
}
