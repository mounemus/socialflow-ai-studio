import { z } from 'zod';
import { handle, created } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';

const PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'] as const;

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
const schema = z
  .object({
    socialAccountId: z.string().optional(),
    socialPageId: z.string().optional(),
    scheduledFor: z.string().datetime().optional(),
    scheduledAt: z.string().datetime().optional(),
    platform: z.string().optional(),
  })
  .refine((b) => b.scheduledFor || b.scheduledAt, {
    message: 'scheduledFor (ou scheduledAt) est requis',
  });

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, post } = await resolvePostContext(id);
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
    const platform = (body.platform ?? '').toUpperCase();
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
        body: post.body ?? '',
        hashtags: post.hashtags,
        mediaUrls: [],
        cta: post.cta ?? undefined,
        linkUrl: post.linkUrl ?? undefined,
        scheduledFor: when,
      },
      when,
    );
  }

  return created({ ...schedule, mode: account ? 'AUTO' : 'MANUAL' });
});
