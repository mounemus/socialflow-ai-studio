import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { InboxIngestionService } from '@/services/inbox/InboxIngestionService';
import { InboxReplyService } from '@/services/inbox/InboxReplyService';
import { ZernioInboxService } from '@/services/inbox/ZernioInboxService';

/**
 * Vercel Cron — every 5 minutes.
 *   1. Sweep all orgs for new social interactions (comments/DMs/mentions).
 *   2. For each org with at least one enabled AutoReplyRule, run auto-reply.
 *
 * Secured by CRON_SECRET (Vercel sends Authorization: Bearer $CRON_SECRET).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const ingestion = await InboxIngestionService.ingestForAllOrgs();

    // Ingestion passerelle Zernio/Late — comptes sans SocialToken natif,
    // indépendante d'ENABLE_REAL_PUBLISHING (le post est réellement publié).
    // Pour chaque org ayant connecté Zernio (UserIntegration provider LATE).
    const lateOrgs = await db.userIntegration.findMany({
      where: { provider: 'LATE', active: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    const zernioResults = [];
    for (const { organizationId } of lateOrgs) {
      try {
        zernioResults.push({
          organizationId,
          ...(await ZernioInboxService.ingestForOrganization(organizationId)),
        });
      } catch (err) {
        logger.error('Zernio inbox ingestion failed for org', {
          organizationId,
          err: (err as Error).message,
        });
      }
    }

    // Run auto-reply only for orgs that actually have enabled rules — avoids
    // touching every org on every tick.
    const orgIdsWithEnabledRules = await db.autoReplyRule.findMany({
      where: { enabled: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    const autoReplyResults = [];
    for (const { organizationId } of orgIdsWithEnabledRules) {
      try {
        autoReplyResults.push(await InboxReplyService.runAutoReplyForOrg(organizationId));
      } catch (err) {
        logger.error('Inbox auto-reply failed for org', {
          organizationId,
          err: (err as Error).message,
        });
      }
    }

    const summary = {
      ingestion,
      zernio: {
        orgs: lateOrgs.length,
        totalComments: zernioResults.reduce((s, r) => s + r.comments, 0),
        totalDms: zernioResults.reduce((s, r) => s + r.dms, 0),
        results: zernioResults,
      },
      autoReply: {
        orgs: orgIdsWithEnabledRules.length,
        totalReplied: autoReplyResults.reduce((s, r) => s + r.autoReplied, 0),
        totalDeferred: autoReplyResults.reduce((s, r) => s + r.deferred, 0),
        totalErrors: autoReplyResults.reduce((s, r) => s + r.errors, 0),
        results: autoReplyResults,
      },
    };
    logger.info('Inbox sync cron complete', summary);
    return NextResponse.json(summary);
  } catch (err) {
    logger.error('Inbox sync cron failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
