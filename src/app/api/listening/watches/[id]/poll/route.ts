import { handle, ok } from '@/lib/api';
import { resolveMentionWatchContext } from '@/lib/tenant';
import { MentionListenerService } from '@/services/listening/MentionListenerService';
import { MentionAlertService } from '@/services/listening/MentionAlertService';

/**
 * POST /api/listening/watches/[id]/poll
 * Trigger an immediate poll of a single watch, then evaluate alert rules over
 * the freshly created mentions (and dispatch to Slack if configured).
 *
 * Org is derived from the watch itself (watch → org) — multi-tenant safe.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { watch } = await resolveMentionWatchContext(id);

  const result = await MentionListenerService.pollWatch(watch.id);

  // Evaluate alert rules over the new mentions (best-effort; polling already
  // persisted the mentions so a failure here is non-fatal).
  let alertsRaised = 0;
  try {
    const evalRes = await MentionAlertService.evaluateWatch(watch.id, result.mentions);
    alertsRaised = evalRes.alerts.length;
    if (watch.slackWebhookUrl && evalRes.alerts.length > 0) {
      for (const alert of evalRes.alerts) {
        await MentionAlertService.dispatchSlack(alert, watch.slackWebhookUrl);
      }
    }
  } catch {
    // Non-fatal — the poll itself succeeded.
  }

  return ok({
    watchId: watch.id,
    found: result.found,
    newMentions: result.new,
    alertsRaised,
    error: result.error ?? null,
  });
});
