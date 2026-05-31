import { handle, ok } from '@/lib/api';
import { resolveInteractionContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { InboxReplyService } from '@/services/inbox/InboxReplyService';

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolveInteractionContext(id);
  requirePermission(role, 'ai.use');
  const suggestion = await InboxReplyService.proposeReply(id);
  return ok(suggestion);
});
