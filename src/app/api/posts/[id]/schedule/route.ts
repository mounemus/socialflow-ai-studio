import { handle, created } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { schedulePostInput } from '@/lib/contracts';
import { publishableMediaUrls } from '@/lib/post-media';
import { sanitizeSocialText } from '@/lib/social-text';
import { describeDestination, resolvePublishTarget } from '@/lib/publish-target';
import { assertMediaFor, assertNotInFlight, assertPublishable, orgRequiresApproval } from '@/lib/post-lifecycle';

/**
 * Programmation — deux façons d'appeler cette route :
 *  - avec `socialAccountId` (Studio → Diffusion) ;
 *  - avec `platform` seul (pipeline, Acte 4) : le compte est RÉSOLU par
 *    `resolvePublishTarget`. Sans compte → créneau en PARTAGE MANUEL (jamais
 *    un faux succès automatique).
 * `scheduledAt` est accepté comme alias de `scheduledFor`.
 * Reprogrammer = remplacer le créneau en attente (jamais deux départs).
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role, post } = await resolvePostContext(id);
  // Programmer déclenche une publication réelle : même permission que /publish.
  requirePermission(role, 'social.publish');
  const body = schedulePostInput.parse(await req.json());
  const when = new Date((body.scheduledFor ?? body.scheduledAt)!);

  assertPublishable(post, await orgRequiresApproval(organizationId));
  await assertNotInFlight(id);

  const target = await resolvePublishTarget(post, organizationId, {
    socialAccountId: body.socialAccountId,
    platform: body.platform ? String(body.platform) : null,
  });
  const destination = describeDestination(target);
  const account = target.account;

  const mediaUrls = account ? await publishableMediaUrls(post, { platform: account.platform }) : [];
  if (account) assertMediaFor(account.platform, mediaUrls);

  await db.postSchedule.deleteMany({
    where: { postId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
  });

  const schedule = await db.postSchedule.create({
    data: {
      postId: id,
      socialAccountId: account?.id ?? null,
      socialPageId: body.socialPageId,
      scheduledFor: when,
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
        mediaUrls,
        cta: post.cta ?? undefined,
        linkUrl: post.linkUrl ?? undefined,
        scheduledFor: when,
      },
      when,
    );
  }

  return created({ ...schedule, mode: account ? 'AUTO' : 'MANUAL', destination });
});
