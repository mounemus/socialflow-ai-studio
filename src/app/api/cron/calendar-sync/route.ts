import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { GoogleCalendarService } from '@/services/integrations/GoogleCalendarService';

/**
 * Vercel Cron — toutes les 30 minutes. Synchronise les PostSchedule
 * programmés de chaque org connectée à Gmail (scope calendar.events) vers
 * son Google Calendar ("primary").
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
    const orgs = await db.userIntegration.findMany({
      where: { provider: 'GMAIL', active: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    const results = [];
    for (const { organizationId } of orgs) {
      try {
        const r = await GoogleCalendarService.syncForOrganization(organizationId);
        results.push({ organizationId, ...r });
      } catch (err) {
        logger.error('Calendar sync failed for org', { organizationId, err: (err as Error).message });
      }
    }

    const summary = {
      orgs: orgs.length,
      totalCreated: results.reduce((s, r) => s + r.created, 0),
      totalUpdated: results.reduce((s, r) => s + r.updated, 0),
      totalDeleted: results.reduce((s, r) => s + r.deleted, 0),
      results,
    };
    logger.info('Calendar sync cron complete', summary);
    return NextResponse.json(summary);
  } catch (err) {
    logger.error('Calendar sync cron failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
