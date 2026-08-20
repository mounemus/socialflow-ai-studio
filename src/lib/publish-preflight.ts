/**
 * Validation PRÉ-VOL d'une publication — caractères, média requis, vidéo pour
 * les formats vidéo, taille de fichier — calculée AVANT de programmer ou de
 * publier. Avant, la limite de caractères n'était vérifiée qu'au moment de
 * publier (adapter.validate) : l'échec arrivait à l'heure H au lieu d'être
 * montré au moment où l'on programme.
 */
import type { SocialPlatform } from '@prisma/client';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { platformAdapters } from '@/services/publisher/adapters';
import { isVideoFormat, isVideoMedia } from '@/lib/media-kind';

export interface PreflightIssue {
  level: 'error' | 'warning';
  message: string;
}

const MEDIA_REQUIRED = new Set(['INSTAGRAM', 'PINTEREST', 'TIKTOK', 'YOUTUBE']);
// Limites majorantes documentées (Graph API / Zernio) — avertir, pas bloquer.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Longueur du message tel qu'il partira (même règle que basicValidate/composeMessage). */
export function messageLength(body: string | null | undefined, hashtags: string[]): number {
  return (body ?? '').length + hashtags.join(' ').length;
}

export function characterLimitFor(platform: string | null | undefined): number | null {
  const p = String(platform ?? '').toUpperCase() as SocialPlatform;
  return platformAdapters[p]?.characterLimit() ?? null;
}

/**
 * Vérifications complètes — retourne la liste des problèmes (vide = prêt).
 * `platform` : plateforme de destination résolue (peut être null → partage manuel).
 */
export async function preflightPost(
  post: { id: string; body: string | null; hashtags: string[]; format?: string | null },
  platform: string | null,
): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const p = String(platform ?? '').toUpperCase();

  const limit = characterLimitFor(p);
  if (limit !== null) {
    const len = messageLength(post.body, post.hashtags);
    if (len > limit) {
      issues.push({ level: 'error', message: `Texte trop long pour ${p} : ${len}/${limit} caractères (hashtags compris).` });
    } else if (len > limit * 0.9) {
      issues.push({ level: 'warning', message: `Texte proche de la limite ${p} : ${len}/${limit} caractères.` });
    }
  }

  const media = await db.mediaAsset.findMany({
    where: { posts: { some: { id: post.id } } },
    select: { id: true, url: true, kind: true, mimeType: true, sizeBytes: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const usable = media.filter((m) => (m.url ?? '').length > 0);
  const videos = usable.filter((m) => isVideoMedia(m));

  if (MEDIA_REQUIRED.has(p) && usable.length === 0) {
    issues.push({ level: 'error', message: `${p} exige un visuel ou une vidéo — ajoute un média avant de programmer.` });
  }
  if (isVideoFormat(post.format) && videos.length === 0) {
    issues.push({
      level: usable.length > 0 ? 'warning' : 'error',
      message: usable.length > 0
        ? 'Format vidéo sans vidéo attachée — une IMAGE partira à la place (génère la vidéo dans Vidéo/Reel).'
        : 'Format vidéo sans aucun média — génère la vidéo dans l’onglet Vidéo/Reel.',
    });
  }

  for (const m of usable) {
    if (!m.sizeBytes) continue;
    const isVid = isVideoMedia(m);
    const max = isVid ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (m.sizeBytes > max) {
      issues.push({
        level: 'warning',
        message: `${isVid ? 'Vidéo' : 'Image'} de ${(m.sizeBytes / 1024 / 1024).toFixed(0)} Mo — au-delà de la limite usuelle ${p || 'plateforme'} (${max / 1024 / 1024} Mo), risque de rejet.`,
      });
    }
  }

  return issues;
}

/** Porte dure côté routes /publish et /schedule : texte au-delà de la limite = refus explicite. */
export function assertTextFor(platform: string | null | undefined, body: string | null | undefined, hashtags: string[]): void {
  const limit = characterLimitFor(platform);
  if (limit === null) return;
  const len = messageLength(body, hashtags);
  if (len > limit) {
    throw new ValidationError(
      `Texte trop long pour ${String(platform).toUpperCase()} : ${len}/${limit} caractères (hashtags compris) — raccourcis le texte avant de publier.`,
      { code: 'TEXT_TOO_LONG', length: len, limit },
    );
  }
}
