import { handle, created } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { schedulePostInput, SOCIAL_PLATFORMS } from '@/lib/contracts';
import { resolvePostPlatform } from '@/lib/post-platform';
import { publishableMediaUrls } from '@/lib/post-media';
import { sanitizeSocialText } from '@/lib/social-text';

const PLATFORMS = SOCIAL_PLATFORMS;

/**
 * Deux façons d'appeler cette route :
 *  - avec `socialAccountId` (Studio → Diffusion) : comportement historique ;
 *  - avec `platform` seul (Acte 5 du pipeline) : la route RÉSOUT le compte
 *    elle-même (marque du post d'abord, puis n'importe quel compte connecté
 *    de l'org). Sans compte → programmation en PARTAGE MANUEL au lieu d'un
 *    échec « Invalid input » : le créneau est posé, l'action apparaît dans
 *    la File de production.
 * `scheduledAt` est accepté comme alias de `scheduledFor`.
 */
const schema = schedulePostInput;

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role, post } = await resolvePostContext(id);
  // Programmer déclenche une publication réelle : même permission que
  // /publish. C'était la SEULE route de publication sans contrôle de rôle
  // (un VIEWER pouvait programmer sur les comptes de l'organisation).
  requirePermission(role, 'social.publish');
  const body = schema.parse(await req.json());
  const when = new Date((body.scheduledFor ?? body.scheduledAt)!);

  // --- Résolution du compte social -----------------------------------------
  let account: { id: string } | null = null;
  if (body.socialAccountId) {
    account = await db.socialAccount.findFirst({
      where: { id: body.socialAccountId, organizationId },
      select: { id: true },
    });
    if (!account) throw new NotFoundError('Social account not found in this organization');
  } else {
    // `Post` ne stocke que `format` — on déduit la plateforme de base, `body`
    // prioritaire s'il est fourni.
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
      // Priorité au compte de la marque du post, sinon n'importe quel compte
      // connecté de l'organisation sur cette plateforme.
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

  // REPROGRAMMATION = REMPLACEMENT. Avant, chaque appel créait un créneau de
  // plus en laissant l'ancien SCHEDULED : le cron publiait les deux (post
  // parti à 10 h ET à 14 h). Les créneaux en vol ou déjà publiés ne sont
  // évidemment pas touchés.
  await db.postSchedule.deleteMany({
    where: { postId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
  });

  const schedule = await db.postSchedule.create({
    data: {
      postId: id,
      socialAccountId: account?.id ?? null,
      socialPageId: body.socialPageId,
      scheduledFor: when,
      // Sans compte : créneau posé en partage manuel — jamais de faux succès
      // de publication automatique.
      shareMode: account ? 'AUTO' : 'MANUAL',
    },
  });
  await db.post.update({ where: { id }, data: { status: 'SCHEDULED' } });

  if (account) {
    await SocialPublisherService.enqueue(
      {
        postId: id,
        scheduleId: schedule.id,
        socialAccountId: account.id,
        socialPageId: body.socialPageId,
        body: sanitizeSocialText(post.body ?? ''),
        hashtags: post.hashtags,
        mediaUrls: await publishableMediaUrls(post),
        cta: post.cta ?? undefined,
        linkUrl: post.linkUrl ?? undefined,
        scheduledFor: when,
      },
      when,
    );
  }

  return created({ ...schedule, mode: account ? 'AUTO' : 'MANUAL' });
});
