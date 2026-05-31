import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveApprovalContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { db } from '@/lib/db';

const schema = z.object({
  feedback: z.string().trim().min(1, 'Un commentaire est requis pour rejeter.').max(2000),
});

/**
 * POST /api/approvals/[id]/reject
 * Reject a pending approval request with required feedback. Requires
 * `post.approve` (OWNER / ADMIN / STRATEGIST and up). The feedback is stored
 * both on the request message and as an approval comment, and the underlying
 * post is sent back to DRAFT.
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  if (!id) throw new NotFoundError('Approval request not found');

  const ctx = await resolveApprovalContext(id);
  requirePermission(ctx.role, 'post.approve');

  const { feedback } = schema.parse(await req.json());

  if (ctx.approval.status === 'REJECTED') {
    throw new ValidationError('Cette demande est déjà rejetée.');
  }
  if (ctx.approval.status === 'APPROVED') {
    throw new ValidationError('Cette demande est déjà approuvée et ne peut plus être rejetée.');
  }

  const [approval] = await db.$transaction([
    db.approvalRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        message: feedback,
      },
      include: { post: { include: { brand: true } }, comments: true },
    }),
    db.post.update({ where: { id: ctx.approval.postId }, data: { status: 'DRAFT' } }),
    db.approvalComment.create({
      data: {
        approvalId: id,
        authorId: ctx.userId,
        body: feedback,
        isInternal: false,
      },
    }),
  ]);

  return ok({ ...approval, rejectedById: ctx.userId });
});
