import { handle, ok } from '@/lib/api';
import { resolveMentionAlertContext } from '@/lib/tenant';
import { MentionAlertService } from '@/services/listening/MentionAlertService';

/**
 * POST /api/listening/alerts/[id]/ack
 * Acknowledge a mention alert. Org is derived from the alert itself
 * (alert → org) — multi-tenant safe.
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { userId } = await resolveMentionAlertContext(id);

  const alert = await MentionAlertService.acknowledgeAlert(id, userId);
  return ok({ alert });
});
