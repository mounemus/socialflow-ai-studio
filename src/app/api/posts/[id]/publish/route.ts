import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { publishPostInput, SOCIAL_PLATFORMS } from '@/lib/contracts';
import { resolvePostPlatform } from '@/lib/post-platform';
import { publishableMediaUrls } from '@/lib/post-media';
import { sanitizeSocialText } from '@/lib/social-text';

const PLATFORMS = SOCIAL_PLATFORMS;

/**
 * Immediate publish — crée un schedule à `scheduledFor=now` et publie
 * synchroniquement.
 *
 * Deux façons d'appeler cette route (mêmes conventions que /schedule) :
 *  - avec `socialAccountId` (Studio → Diffusion) : comportement historique ;
 *  - avec `platform` seul (Acte 5 du pipeline) : la route RÉSOUT le compte
 *    elle-même (compte de la marque du post d'abord, puis n'importe quel
 *    compte connecté de l'org sur cette plateforme). Sans compte → réponse
 *    « partage manuel » explicite au lieu d'un échec « Invalid input ».
 */
const schema = publishPostInput;

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role, post } = await resolvePostContext(id);
  requirePermission(role, 'social.publish');
  const body = schema.parse(await req.json().catch(() => ({})));

  // --- Résolution du compte social (identique à /schedule) ------------------
  let account: { id: string } | null = null;
  if (body.socialAccountId) {
    account = await db.socialAccount.findFirst({
      where: { id: body.socialAccountId, organizationId },
      select: { id: true },
    });
    if (!account) throw new NotFoundError('Social account not found in this organization');
  } else {
    // `Post` ne stocke que `format` (INSTAGRAM_POST) — on déduit la plateforme
    // de base, avec le `platform` du body en priorité s'il est fourni.
    const platform =
      (body.platform ? String(body.platform).toUpperCase() : '') ||
      (await resolvePostPlatform(post)) ||
      '';
    if ((PLATFORMS as readonly string[]).includes(platform)) {
      const connectable = {
        organizationId,
        platform: platform as (typeof PLATFORMS)[number],
        status: { in: ['CONNECTED', 'DEGRADED'] as ('CONNECTED' | 'DEGRADED')[] },
      };
      account =
        (post.brandId
          ? await db.socialAccount.findFirst({
              where: { ...connectable, brandId: post.brandId },
              select: { id: true },
            })
          : null) ??
        (await db.socialAccount.findFirst({ where: connectable, select: { id: true } }));
    }
  }

  // Sans compte connecté : jamais de faux succès — on renvoie une action
  // manuelle explicite (le client affiche un message clair au lieu de « Publié »).
  if (!account) {
    return ok({
      published: false,
      mode: 'MANUAL',
      message: `Aucun compte ${(body.platform ?? '').toString() || 'social'} connecté — connectez un compte ou publiez manuellement.`,
    });
  }

  // « Publier maintenant » CONSOMME les créneaux en attente : avant, le
  // créneau SCHEDULED existant restait actif et le cron republiait le même
  // contenu à l'heure prévue (double publication réelle).
  await db.postSchedule.deleteMany({
    where: { postId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
  });

  const schedule = await db.postSchedule.create({
    data: {
      postId: id,
      socialAccountId: account.id,
      scheduledFor: new Date(),
    },
  });

  const result = await SocialPublisherService.publishNow({
    postId: id,
    scheduleId: schedule.id,
    socialAccountId: account.id,
    body: sanitizeSocialText(post.body ?? ''),
    hashtags: post.hashtags,
    mediaUrls: await publishableMediaUrls(post),
  });

  return ok({ schedule, result, mode: 'AUTO' });
});
