/**
 * Détection vidéo PARTAGÉE client/serveur. Le champ Prisma est `kind`
 * (IMAGE | VIDEO) — le Studio lisait `type`, qui n'existe pas : une vidéo
 * attachée n'était jamais reconnue (aperçu Reel vide, « Aucune vidéo attachée »).
 */
export type MediaLite = {
  id?: string;
  url: string | null;
  kind?: string | null;
  /** Alias toléré (anciens objets client). */
  type?: string | null;
  mimeType?: string | null;
};

export function isVideoMedia(media: MediaLite): boolean {
  const kind = String(media.kind ?? media.type ?? '').toUpperCase();
  if (kind.includes('VIDEO')) return true;
  if ((media.mimeType ?? '').startsWith('video/')) return true;
  const path = (media.url ?? '').split('?')[0].toLowerCase();
  return /\.(mp4|mov|webm|m4v)$/.test(path) || (media.url ?? '').startsWith('data:video/');
}

/** Formats dont le média principal est une vidéo (Reel, Story, TikTok, Short…). */
export function isVideoFormat(format: string | null | undefined): boolean {
  const f = String(format ?? '').toUpperCase();
  return ['INSTAGRAM_REEL', 'INSTAGRAM_STORY', 'FACEBOOK_STORY', 'TIKTOK_VIDEO', 'YOUTUBE_SHORT', 'VIDEO_SCRIPT', 'STORYBOARD'].includes(f);
}
