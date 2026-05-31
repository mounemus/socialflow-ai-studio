import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveInteractionContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { InboxReplyService } from '@/services/inbox/InboxReplyService';

const bodySchema = z.object({
  content: z.string().min(1).max(2000),
});

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { userId, role } = await resolveInteractionContext(id);
  requirePermission(role, 'social.publish');
  const { content } = bodySchema.parse(await req.json());
  const result = await InboxReplyService.postReply(id, content, userId);
  return ok(result);
});
