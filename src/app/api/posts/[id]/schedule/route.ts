import { z } from 'zod';
import { handle, created } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';

const schema = z.object({
  socialAccountId: z.string(),
  socialPageId: z.string().optional(),
  scheduledFor: z.string().datetime(),
});

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, post } = await resolvePostContext(id);
  const body = schema.parse(await req.json());

  const account = await db.socialAccount.findFirst({
    where: { id: body.socialAccountId, organizationId },
  });
  if (!account) throw new NotFoundError('Social account not found in this organization');

  const schedule = await db.postSchedule.create({
    data: {
      postId: id,
      socialAccountId: body.socialAccountId,
      socialPageId: body.socialPageId,
      scheduledFor: new Date(body.scheduledFor),
    },
  });
  await db.post.update({ where: { id }, data: { status: 'SCHEDULED' } });

  await SocialPublisherService.enqueue(
    {
      postId: id,
      scheduleId: schedule.id,
      socialAccountId: body.socialAccountId,
      socialPageId: body.socialPageId,
      body: post.body ?? '',
      hashtags: post.hashtags,
      mediaUrls: [],
      cta: post.cta ?? undefined,
      linkUrl: post.linkUrl ?? undefined,
      scheduledFor: new Date(body.scheduledFor),
    },
    new Date(body.scheduledFor),
  );

  return created(schedule);
});
