import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveScheduleContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const schema = z.object({
  sharedAt: z.string().datetime().optional(),
  channel: z.string().optional(),
});

/**
 * Mark a single schedule as manually shared. Schedule-id variant of
 * /api/posts/[id]/manual-share — used when the user wants to share one
 * specific channel/schedule rather than every MANUAL schedule on the post.
 *
 * Body: { sharedAt?: ISO, channel?: string }
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, schedule, organizationId } = await resolveScheduleContext(id);
  requirePermission(role, 'post.edit');

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});
  const sharedAt = body.sharedAt ? new Date(body.sharedAt) : new Date();

  const updated = await db.postSchedule.update({
    where: { id },
    data: {
      manualSharedAt: sharedAt,
      status: 'PUBLISHED',
      publishedAt: sharedAt,
    },
  });

  // Bubble status up to the post if every schedule is now published.
  const stillOpen = await db.postSchedule.count({
    where: { postId: schedule.postId, status: { not: 'PUBLISHED' } },
  });
  if (stillOpen === 0) {
    await db.post.update({
      where: { id: schedule.postId },
      data: { status: 'PUBLISHED' },
    });
  }

  await db.apiLog.create({
    data: {
      organizationId,
      platform: body.channel ?? null,
      endpoint: `/api/schedules/${id}/share`,
      method: 'POST',
      statusCode: 200,
      requestBody: { sharedAt: sharedAt.toISOString(), channel: body.channel } as never,
      responseBody: { scheduleId: id, postId: schedule.postId } as never,
    },
  });

  return ok({
    schedule: updated,
    sharedAt: sharedAt.toISOString(),
    channel: body.channel ?? null,
  });
});
