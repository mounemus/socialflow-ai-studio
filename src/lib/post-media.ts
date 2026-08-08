import { db } from '@/lib/db';

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'https://socialflow-ai-studio.vercel.app';
  return raw.replace(/\/$/, '');
}

/** Rend une URL publiable : http(s) tel quel, data URL servie par l'app. */
function publicUrlOf(media: { id: string; url: string | null }): string | null {
  if (!media.url) return null;
  if (/^https?:\/\//i.test(media.url)) return media.url;
  // Les visuels OpenAI/Gemini sont en base64 : intransmissibles à un réseau
  // social, on les expose via une URL publique servie par l'application.
  if (media.url.startsWith('data:')) return `${appBaseUrl()}/api/media/${media.id}/raw`;
  return null;
}

/**
 * Visuel(s) à publier pour un post.
 *
 * Règle : UN SEUL visuel — celui explicitement choisi (couverture), sinon le
 * plus récent. Les générations successives s'accumulent en médias (un post en
 * comptait 83) : renvoyer toute la collection aurait publié 83 images. La
 * sélection se fait depuis la vue publication.
 */
export async function publishableMediaUrls(post: {
  id: string;
  metadata?: unknown;
}): Promise<string[]> {
  const meta = (post.metadata ?? null) as Record<string, unknown> | null;

  // 1. Couverture désignée par un identifiant de média.
  const coverMediaId =
    typeof meta?.coverMediaId === 'string' ? (meta.coverMediaId as string) : null;
  if (coverMediaId) {
    const cover = await db.mediaAsset.findUnique({
      where: { id: coverMediaId },
      select: { id: true, url: true },
    });
    const url = cover ? publicUrlOf(cover) : null;
    if (url) return [url];
  }

  // 2. Couverture désignée par URL directe.
  for (const key of ['coverUrl', 'coverImageUrl']) {
    const v = meta?.[key];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return [v];
  }

  // 3. À défaut : le visuel le plus récent attaché au post.
  const latest = await db.mediaAsset.findFirst({
    where: { posts: { some: { id: post.id } } },
    select: { id: true, url: true },
    orderBy: { createdAt: 'desc' },
  });
  const url = latest ? publicUrlOf(latest) : null;
  return url ? [url] : [];
}
