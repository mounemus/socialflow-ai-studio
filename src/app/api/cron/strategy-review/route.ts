import { NextResponse } from 'next/server';
import { StrategyReviewService } from '@/services/intelligence/StrategyReviewService';
import { logger } from '@/lib/logger';

/**
 * Weekly Vercel Cron — self-improving loop.
 * Reviews all active strategies and writes a review note + adjustment proposals.
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
    const result = await StrategyReviewService.runAll();
    logger.info('Weekly strategy review complete', result);
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Strategy review failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
