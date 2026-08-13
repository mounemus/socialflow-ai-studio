import { handle, ok } from '@/lib/api';
import { resolveApprovalContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { db } from '@/lib/db';
import { markLinkedItemReadyFromPost } from '@/lib/post-item-sync';

/**
 * POST /api/approvals/[id]/approve
 * Approve a pending approval request. Requires `post.approve`
 * (OWNER / ADMIN / STRATEGIST and up). Stamps the approver + decision time
 * and marks the underlying post APPROVED.
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  if (!id) throw new NotFoundError('Approval request not found');

  const ctx = await resolveApprovalContext(id);
  requirePermission(ctx.role, 'post.approve');

  if (ctx.approval.status === 'APPROVED') {
    throw new ValidationError('Cette demande est déjà approuvée.');
  }
  if (ctx.approval.status === 'REJECTED') {
    throw new ValidationError('Cette demande a été rejetée et ne peut plus être approuvée.');
  }

  const [approval] = await db.$transaction([
    db.approvalRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        requestedBy: ctx.approval.requestedBy, // preserve
      },
      include: { post: { include: { brand: true } }, comments: true },
    }),
    db.post.update({ where: { id: ctx.approval.postId }, data: { status: 'APPROVED' } }),
    db.approvalComment.create({
      data: {
        approvalId: id,
        authorId: ctx.userId,
        body: 'Demande approuvée.',
        isInternal: true,
      },
    }),
  ]);

  // Boucle de validation UNIQUE : approuver en Production marque aussi l'item
  // de stratégie lié comme « prêt » dans le pipeline (write-through).
  await markLinkedItemReadyFromPost(ctx.approval.postId);

  return ok({ ...approval, approvedById: ctx.userId });
});
