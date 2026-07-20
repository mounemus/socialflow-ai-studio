import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { AnalyticsCollectorService } from '@/services/analytics/AnalyticsCollectorService';

/**
 * Vercel Cron — toutes les 6 heures.
 * Collecte les métriques réelles (FB/IG/LinkedIn) des posts publiés vers
 * PostAnalytics. Ne fabrique jamais de données : sans mode réel ni tokens,
 * la collecte est simplement ignorée (et le dit).
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
    const result = await AnalyticsCollectorService.collectForAllOrgs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron analytics-sync failed', { err: (err as Error).message });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
