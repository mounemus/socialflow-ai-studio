import { z } from 'zod';
import { handle, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
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
  const ctx = await requireTenant();
  const body = schema.parse(await req.json());

  const post = await db.post.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!post) throw new NotFoundError('Post not found');

  const account = await db.socialAccount.findFirst({
    where: { id: body.socialAccountId, organizationId: ctx.organizationId },
  });
  if (!account) throw new NotFoundError('Social account not found');

  const schedule = await db.postSchedule.create({
    data: {
      postId: id,
      socialAccountId: body.socialAccountId,
      socialPageId: body.socialPageId,
      scheduledFor: new Date(body.scheduledFor),
    },
  });
  await db.post.update({ where: { id }, data: { status: 'SCHEDULED' } });

  // Enqueue via publisher service (will run sync if no Redis).
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
