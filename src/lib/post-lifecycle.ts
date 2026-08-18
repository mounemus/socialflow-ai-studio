/**
 * Cycle de vie UNIQUE d'un post — règles partagées par les routes publish /
 * schedule, le pipeline et la file de production :
 *
 *   Idée → Brouillon → (En validation → ) Prêt à publier → Programmé → Publié
 *
 * La validation est une PORTE OPTIONNELLE de l'organisation
 * (`Organization.settings.requireApproval`, off par défaut) — pas une étape
 * obligatoire. Avant : la concrétisation mettait tout post en PENDING_APPROVAL
 * (« En validation » à vie dans la file), rien ne fermait la demande
 * d'approbation à la publication, et rien n'empêchait un double clic
 * « Publier » de créer deux créneaux.
 */
import type { Post } from '@prisma/client';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';

/** Statuts qui signifient « déjà parti / en train de partir ». */
export const IN_FLIGHT_STATUSES = ['PUBLISHING', 'UPLOADING', 'PROCESSING', 'QUEUED'] as const;
export const PUBLISHED_STATUSES = ['PUBLISHED', 'SIMULATED'] as const;

export async function orgRequiresApproval(organizationId: string): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  return settings.requireApproval === true;
}

/** Statut « prêt » après concrétisation : porte de validation si l'org l'exige, sinon prêt à publier. */
export async function readyStatusFor(organizationId: string): Promise<'PENDING_APPROVAL' | 'APPROVED'> {
  return (await orgRequiresApproval(organizationId)) ? 'PENDING_APPROVAL' : 'APPROVED';
}

/**
 * Porte de validation : si l'org exige une approbation, un post non validé ne
 * peut être ni publié ni programmé. Statuts acceptés : APPROVED et tout ce qui
 * est déjà en aval (programmé/publié → republier ou reprogrammer reste possible).
 */
export function assertPublishable(post: Pick<Post, 'status'>, requireApproval: boolean): void {
  if (!requireApproval) return;
  const downstream = ['APPROVED', 'SCHEDULED', ...IN_FLIGHT_STATUSES, ...PUBLISHED_STATUSES, 'FAILED', 'ACTION_REQUIRED', 'MANUAL_SHARE_REQUIRED'];
  if (!downstream.includes(post.status)) {
    throw new ValidationError(
      'Cette organisation exige une validation avant publication — demande une validation depuis la file de production.',
      { code: 'APPROVAL_REQUIRED', status: post.status },
    );
  }
}

/**
 * Anti double-publication : un créneau déjà en vol pour ce post → on refuse
 * (409) au lieu de créer un second créneau et de publier deux fois.
 */
export async function assertNotInFlight(postId: string): Promise<void> {
  const inFlight = await db.postSchedule.findFirst({
    where: { postId, status: { in: [...IN_FLIGHT_STATUSES] } },
    select: { id: true, status: true },
  });
  if (inFlight) {
    throw new ValidationError('Une publication est déjà en cours pour ce contenu — patiente quelques secondes.', {
      code: 'PUBLISH_IN_FLIGHT',
      scheduleId: inFlight.id,
    });
  }
}

/** Ferme les demandes d'approbation encore ouvertes une fois le post parti. */
export async function closePendingApprovals(postId: string): Promise<number> {
  const r = await db.approvalRequest.updateMany({
    where: { postId, status: { in: ['PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED'] } },
    data: { status: 'APPROVED', decidedAt: new Date() },
  });
  return r.count;
}

/**
 * Auto-réparation des posts hérités : une org qui n'exige PAS de validation
 * n'a rien à faire d'un post « En validation » sans demande ouverte — il est
 * prêt à publier. Idempotent, appelé au chargement de la file de production.
 * ponytail: nettoyage à la lecture plutôt qu'une migration one-shot (pas
 * d'accès DB hors Vercel) — retirer quand plus aucun PENDING_APPROVAL hérité.
 */
export async function normalizeLegacyPendingApproval(organizationId: string): Promise<number> {
  if (await orgRequiresApproval(organizationId)) return 0;
  const r = await db.post.updateMany({
    where: {
      organizationId,
      status: 'PENDING_APPROVAL',
      approvals: { none: { status: { in: ['PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED'] } } },
    },
    data: { status: 'APPROVED' },
  });
  return r.count;
}

/**
 * Pré-requis média par plateforme, vérifié AVANT d'appeler le réseau : un post
 * Instagram sans visuel échouait chez Zernio avec un message obscur.
 */
export function assertMediaFor(platform: string | null | undefined, mediaUrls: string[]): void {
  const p = String(platform ?? '').toUpperCase();
  if ((p === 'INSTAGRAM' || p === 'PINTEREST' || p === 'TIKTOK' || p === 'YOUTUBE') && mediaUrls.length === 0) {
    throw new ValidationError(
      `${p === 'INSTAGRAM' ? 'Instagram' : p.charAt(0) + p.slice(1).toLowerCase()} exige un visuel ou une vidéo — génère ou ajoute un média avant de publier.`,
      { code: 'MEDIA_REQUIRED', platform: p },
    );
  }
}
