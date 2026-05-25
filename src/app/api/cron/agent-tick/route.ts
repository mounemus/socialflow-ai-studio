import { NextResponse } from 'next/server';
import { OperatorAgent } from '@/services/agent/OperatorAgent';
import { logger } from '@/lib/logger';

/**
 * Vercel Cron endpoint - configure in vercel.json with a schedule like "*5 * * * *".
 * Vercel calls this with a special header that we check via CRON_SECRET.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    const result = await OperatorAgent.tickAll();
    logger.info('Cron tick complete', result);
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Cron tick failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
