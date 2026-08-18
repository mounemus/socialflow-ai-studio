import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { publishPostInput } from '@/lib/contracts';
import { publishableMediaUrls } from '@/lib/post-media';
import { sanitizeSocialText } from '@/lib/social-text';
import { describeDestination, resolvePublishTarget } from '@/lib/publish-target';
import { assertMediaFor, assertNotInFlight, assertPublishable, orgRequiresApproval } from '@/lib/post-lifecycle';

/**
 * Publication immédiate — crée un créneau à `scheduledFor=now` et publie
 * synchroniquement.
 *
 * Deux façons d'appeler cette route (mêmes conventions que /schedule) :
 *  - avec `socialAccountId` (Studio → Diffusion) ;
 *  - avec `platform` seul (pipeline, Acte 4) : la route RÉSOUT le compte
 *    elle-même (`resolvePublishTarget`). Sans compte → réponse « partage
 *    manuel » explicite, jamais un faux succès.
 *
 * Garde-fous : porte de validation optionnelle de l'organisation
 * (`requireApproval`), refus si une publication est déjà en vol (double clic).
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role, post } = await resolvePostContext(id);
  requirePermission(role, 'social.publish');
  const body = publishPostInput.parse(await req.json().catch(() => ({})));

  assertPublishable(post, await orgRequiresApproval(organizationId));
  await assertNotInFlight(id);

  const target = await resolvePublishTarget(post, organizationId, {
    socialAccountId: body.socialAccountId,
    platform: body.platform ? String(body.platform) : null,
  });
  const destination = describeDestination(target);

  if (!target.account) {
    return ok({
      published: false,
      mode: 'MANUAL',
      destination,
      message: `Aucun compte ${target.platform ?? 'social'} connecté — connecte un compte ou publie manuellement.`,
    });
  }

  // Pré-requis média (Instagram exige un visuel) — AVANT de créer un créneau.
  const mediaUrls = await publishableMediaUrls(post, { platform: target.account.platform });
  assertMediaFor(target.account.platform, mediaUrls);

  // « Publier maintenant » CONSOMME les créneaux en attente : sinon le cron
  // republiait le même contenu à l'heure prévue (double publication réelle).
  await db.postSchedule.deleteMany({
    where: { postId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
  });

  const schedule = await db.postSchedule.create({
    data: { postId: id, socialAccountId: target.account.id, scheduledFor: new Date() },
  });

  const result = await SocialPublisherService.publishNow({
    postId: id,
    scheduleId: schedule.id,
    socialAccountId: target.account.id,
    body: sanitizeSocialText(post.body ?? ''),
    hashtags: post.hashtags,
    mediaUrls,
  });

  return ok({ schedule, result, mode: 'AUTO', destination });
});
