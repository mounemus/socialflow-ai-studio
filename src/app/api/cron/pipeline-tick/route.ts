import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

/**
 * Vercel Cron — toutes les 5 minutes. AVANT ce cron, RIEN côté serveur ne
 * faisait avancer un pipeline : l'exécution ne partait que si une page restait
 * ouverte à poster /advance. Onglet fermé après validation = run figé en
 * RUNNING pour toujours, invisible du tableau de bord.
 *
 * Ramasse les runs RUNNING sur une étape de TRAVAIL (pas les portes admin),
 * inactifs depuis >2 min (pour ne pas concurrencer une page active — le verrou
 * lockedAt protège de toute façon), et les avance. advanceStep est idempotent
 * et verrouillé.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TAKE = 3; // étapes potentiellement longues (génération 2-3 min)
const IDLE_MS = 2 * 60 * 1000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const runs = await db.brandPipelineRun.findMany({
    where: {
      status: 'RUNNING',
      step: { in: ['CREATE_BRAND', 'ENRICH_PROFILE', 'GENERATE_STRATEGY', 'EXECUTE_ITEMS'] },
      updatedAt: { lte: new Date(Date.now() - IDLE_MS) },
    },
    orderBy: { updatedAt: 'asc' },
    take: TAKE,
    select: { id: true, step: true },
  });

  const details: Array<{ runId: string; step: string; outcome: string }> = [];
  for (const run of runs) {
    try {
      const res = await BrandPipelineService.advanceStep(run.id);
      details.push({
        runId: run.id,
        step: run.step,
        outcome: res.success ? `→ ${res.data?.nextStep ?? '?'}` : `failed:${res.reason ?? ''}`,
      });
    } catch (err) {
      const message = (err as Error).message;
      logger.error('cron pipeline-tick: advance failed', { runId: run.id, err: message });
      details.push({ runId: run.id, step: run.step, outcome: `error:${message.slice(0, 120)}` });
    }
  }

  if (runs.length > 0) logger.info('cron pipeline-tick', { advanced: runs.length, details });
  return NextResponse.json({ ok: true, advanced: runs.length, details });
}
