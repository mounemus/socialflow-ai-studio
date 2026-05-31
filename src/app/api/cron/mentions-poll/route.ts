import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { MentionListenerService } from '@/services/listening/MentionListenerService';
import { MentionAlertService } from '@/services/listening/MentionAlertService';

/**
 * Vercel Cron — every 30 minutes.
 *   For each enabled MentionWatch:
 *     1. poll external sources for new BrandMention rows
 *     2. evaluate alert rules over the new mentions
 *     3. dispatch any raised alerts to the watch's Slack webhook
 *
 * Secured by CRON_SECRET (Vercel sends Authorization: Bearer $CRON_SECRET).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    // Poll every enabled watch (creates BrandMention rows + classifies sentiment).
    const poll = await MentionListenerService.pollAllEnabled();

    // Map watchId → slackWebhookUrl so we can dispatch without re-querying.
    const watches = await db.mentionWatch.findMany({
      where: { enabled: true },
      select: { id: true, slackWebhookUrl: true },
    });
    const webhookByWatch = new Map(watches.map((w) => [w.id, w.slackWebhookUrl]));

    let alertsRaised = 0;
    let slackDispatched = 0;
    const perWatch: Array<{ watchId: string; created: number; alerts: number }> = [];

    for (const result of poll.results) {
      try {
        const evalRes = await MentionAlertService.evaluateWatch(
          result.watchId,
          result.mentions,
        );
        alertsRaised += evalRes.alerts.length;
        perWatch.push({
          watchId: result.watchId,
          created: result.new,
          alerts: evalRes.alerts.length,
        });

        const webhook = webhookByWatch.get(result.watchId);
        if (webhook && evalRes.alerts.length > 0) {
          for (const alert of evalRes.alerts) {
            const ok = await MentionAlertService.dispatchSlack(alert, webhook);
            if (ok) slackDispatched += 1;
          }
        }
      } catch (err) {
        logger.error('mentions-poll: watch evaluation failed', {
          watchId: result.watchId,
          err: (err as Error).message,
        });
      }
    }

    const summary = {
      watches: poll.watches,
      mentionsCreated: poll.totalNew,
      alertsRaised,
      slackDispatched,
      perWatch,
    };
    logger.info('Mentions poll cron complete', summary);
    return NextResponse.json(summary);
  } catch (err) {
    logger.error('Mentions poll cron failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
