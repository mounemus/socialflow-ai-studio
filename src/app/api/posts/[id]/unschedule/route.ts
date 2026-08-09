import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';

/**
 * Déprogrammer un post : annule ses schedules non-terminaux et le renvoie en
 * « Validé » (colonne approved). Miroir du DELETE /api/schedules/[id] mais au
 * niveau du post — utilisé par la Production et la vue détail pour ramener un
 * post programmé en arrière sans passer par le calendrier.
 */
const NON_CANCELLABLE_SCHEDULE_STATUSES = ['PUBLISHED', 'PUBLISHING'] as const;

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');

  const post = await db.post.findUnique({ where: { id } });
  if (!post) throw new AppError('Post not found', 404, 'NOT_FOUND');

  if (post.status === 'PUBLISHED' || post.status === 'PUBLISHING') {
    throw new AppError('Cannot unschedule a published/publishing post', 400, 'INVALID_STATUS');
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.postSchedule.deleteMany({
      where: { postId: id, status: { notIn: [...NON_CANCELLABLE_SCHEDULE_STATUSES] } },
    });
    return tx.post.update({ where: { id }, data: { status: 'APPROVED' } });
  });

  return ok(updated);
});
