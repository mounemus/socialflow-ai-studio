import { db } from '@/lib/db';

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'https://socialflow-ai-studio.vercel.app';
  return raw.replace(/\/$/, '');
}

/**
 * URL de visuel SIMULÉ (placeholder d'échec IA, photo de stock du mock) —
 * jamais publiable au nom d'une marque.
 */
export function isPlaceholderVisualUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return /(^|\/\/)(www\.)?(placehold\.co|picsum\.photos|via\.placeholder\.com)\//i.test(url);
}

/** Rend une URL publiable : http(s) tel quel, data URL servie par l'app. */
function publicUrlOf(media: { id: string; url: string | null }): string | null {
  if (!media.url) return null;
  // Un placeholder de génération ratée ne part JAMAIS sur un réseau.
  if (isPlaceholderVisualUrl(media.url)) return null;
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
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && !isPlaceholderVisualUrl(v)) return [v];
  }

  // 3. À défaut : le visuel UTILISABLE le plus récent attaché au post.
  // On en balaye plusieurs : une génération ratée (URL vide ou placeholder)
  // en tête de pile rendait impubliable un post qui avait une image valide.
  const latest = await db.mediaAsset.findMany({
    where: { posts: { some: { id: post.id } } },
    select: { id: true, url: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const m of latest) {
    const url = publicUrlOf(m);
    if (url) return [url];
  }
  return [];
}
