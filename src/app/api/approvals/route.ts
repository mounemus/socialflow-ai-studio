import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

const schema = z.object({
  postId: z.string(),
  reviewerEmail: z.string().email().optional(),
  message: z.string().optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const approvals = await db.approvalRequest.findMany({
    where: { organizationId: ctx.organizationId },
    include: { post: { include: { brand: true } }, comments: true },
    orderBy: { createdAt: 'desc' },
  });
  return ok(approvals);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = schema.parse(await req.json());
  const a = await db.approvalRequest.create({
    data: {
      organizationId: ctx.organizationId,
      postId: body.postId,
      requestedBy: ctx.userId,
      reviewerEmail: body.reviewerEmail,
      message: body.message,
    },
  });
  await db.post.update({ where: { id: body.postId }, data: { status: 'PENDING_APPROVAL' } });
  return created(a);
});
