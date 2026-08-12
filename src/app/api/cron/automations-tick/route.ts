import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

/**
 * Cron — évalue les Automations ACTIVE et exécute celles qui sont dues.
 * C'était le chaînon manquant : le planner créait des workflows, l'activation
 * posait un statut, et rien ne les exécutait jamais (le worker BullMQ n'a pas
 * de producteur et ne tourne pas sur Vercel).
 *
 * Triggers évalués : DATE (une fois, puis PAUSED) et FREQUENCY
 * (triggerConfig.every: 'daily' par défaut | 'weekly'). Les autres types
 * (NEW_TREND, POST_APPROVED…) sont ignorés tant qu'aucun évaluateur n'existe.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY = 86_400_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const autos = await db.automation.findMany({
    where: { status: 'ACTIVE', triggerType: { in: ['DATE', 'FREQUENCY'] } },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  const now = Date.now();
  const results: Array<{ id: string; name: string; ok?: boolean; skipped?: string }> = [];
  for (const a of autos) {
    const last = a.runs[0];
    if (last?.status === 'RUNNING') {
      results.push({ id: a.id, name: a.name, skipped: 'run-en-cours' });
      continue;
    }
    const cfg = (a.triggerConfig as { date?: string; every?: string } | null) ?? {};
    let due = false;
    let oneShot = false;
    if (a.triggerType === 'DATE') {
      const at = cfg.date ? new Date(cfg.date).getTime() : NaN;
      due = Number.isFinite(at) && at <= now && !last;
      oneShot = true;
    } else {
      // Marge de 5 % pour ne pas glisser d'un tick à chaque passage.
      const interval = (cfg.every === 'weekly' ? 7 * DAY : DAY) * 0.95;
      due = !last || now - new Date(last.createdAt).getTime() >= interval;
    }
    if (!due) {
      results.push({ id: a.id, name: a.name, skipped: 'pas-encore-du' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await AutomationEngine.runById(a.id);
    if (r.ok && oneShot) {
      // eslint-disable-next-line no-await-in-loop
      await db.automation.update({ where: { id: a.id }, data: { status: 'PAUSED' } });
    }
    results.push({ id: a.id, name: a.name, ok: r.ok });
  }

  logger.info('Cron automations-tick complete', {
    evaluated: autos.length,
    ran: results.filter((r) => r.ok !== undefined).length,
  });
  return NextResponse.json({ evaluated: autos.length, results });
}
