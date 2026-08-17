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

/**
 * Gabarit imposé par la plateforme cible : Instagram refuse les images hors
 * ratio [0.75 ; 1.91] → on sert le média via /api/media/[id]/raw?fit=instagram
 * qui recadre à la volée si besoin (sinon redirige vers l'original).
 */
export type MediaFitPlatform = 'INSTAGRAM';

function fitFor(platform?: string | null): 'instagram' | null {
  return String(platform ?? '').toUpperCase() === 'INSTAGRAM' ? 'instagram' : null;
}

/** Rend une URL publiable : http(s) tel quel, data URL servie par l'app. */
function publicUrlOf(media: { id: string; url: string | null }, fit: 'instagram' | null = null): string | null {
  if (!media.url) return null;
  // Un placeholder de génération ratée ne part JAMAIS sur un réseau.
  if (isPlaceholderVisualUrl(media.url)) return null;
  const isRemote = /^https?:\/\//i.test(media.url);
  const isData = media.url.startsWith('data:');
  if (!isRemote && !isData) return null;
  // Recadrage plateforme : toujours via notre route (elle redirige vers la
  // source si le ratio est déjà conforme).
  if (fit) return `${appBaseUrl()}/api/media/${media.id}/raw?fit=${fit}`;
  if (isRemote) return media.url;
  // Les visuels OpenAI/Gemini sont en base64 : intransmissibles à un réseau
  // social, on les expose via une URL publique servie par l'application.
  return `${appBaseUrl()}/api/media/${media.id}/raw`;
}

/**
 * Visuel(s) à publier pour un post.
 *
 * Règle : UN SEUL visuel — celui explicitement choisi (couverture), sinon le
 * plus récent. Les générations successives s'accumulent en médias (un post en
 * comptait 83) : renvoyer toute la collection aurait publié 83 images. La
 * sélection se fait depuis la vue publication.
 */
export async function publishableMediaUrls(
  post: {
    id: string;
    metadata?: unknown;
    format?: string | null;
  },
  opts: { platform?: string | null } = {},
): Promise<string[]> {
  const meta = (post.metadata ?? null) as Record<string, unknown> | null;
  const fit = fitFor(opts.platform);

  // 0. CARROUSEL : toutes les slides partent, dans l'ordre autoritaire de
  // metadata.slides (l'éditeur). Avant, la règle « un seul visuel » réduisait
  // tout carrousel à une slide unique — le travail de l'éditeur ne sortait
  // jamais.
  if (String(post.format ?? '').includes('CAROUSEL')) {
    const slides = Array.isArray(meta?.slides)
      ? (meta!.slides as Array<{ mediaId?: string; url?: string }>)
      : [];
    const urls: string[] = [];
    for (const s of slides.slice(0, 10)) {
      let u: string | null = null;
      if (s.mediaId) {
        const m = await db.mediaAsset.findUnique({
          where: { id: s.mediaId },
          select: { id: true, url: true },
        });
        u = m ? publicUrlOf(m, fit) : null;
      }
      if (!u && typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && !isPlaceholderVisualUrl(s.url)) {
        u = s.url;
      }
      if (u) urls.push(u);
    }
    if (urls.length > 0) return urls;
    // Pas de slides éditées : tous les visuels image attachés, ordre de création.
    const media = await db.mediaAsset.findMany({
      where: { posts: { some: { id: post.id } }, kind: 'IMAGE' },
      select: { id: true, url: true },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const fallback = media.map((m) => publicUrlOf(m, fit)).filter((u): u is string => !!u);
    if (fallback.length > 0) return fallback;
    // sinon : logique de couverture standard ci-dessous.
  }

  // 1. Couverture désignée par un identifiant de média.
  const coverMediaId =
    typeof meta?.coverMediaId === 'string' ? (meta.coverMediaId as string) : null;
  if (coverMediaId) {
    const cover = await db.mediaAsset.findUnique({
      where: { id: coverMediaId },
      select: { id: true, url: true },
    });
    const url = cover ? publicUrlOf(cover, fit) : null;
    if (url) return [url];
  }

  // 2. Couverture désignée par URL directe (recadrée si on retrouve le média).
  for (const key of ['coverUrl', 'coverImageUrl']) {
    const v = meta?.[key];
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && !isPlaceholderVisualUrl(v)) {
      if (fit) {
        const m = await db.mediaAsset.findFirst({ where: { url: v }, select: { id: true, url: true } });
        const fitted = m ? publicUrlOf(m, fit) : null;
        if (fitted) return [fitted];
      }
      return [v];
    }
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
    const url = publicUrlOf(m, fit);
    if (url) return [url];
  }
  return [];
}
