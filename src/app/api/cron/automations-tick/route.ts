import { NextResponse } from 'next/server';
import type { Automation } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

/**
 * Cron — évalue les Automations ACTIVE et exécute celles qui sont dues.
 *
 * Triggers temporels : DATE (une fois, puis PAUSED), FREQUENCY
 * (triggerConfig.every: 'daily' par défaut | 'weekly').
 *
 * Triggers événementiels (branchés sur les vraies données, filigrane = date du
 * dernier run) : NEW_TREND / NEW_RSS_ITEM / NEW_KEYWORD_HIT (TrendItem),
 * NEW_COMPETITOR_POST (CompetitorPost), POST_FAILED (PostSchedule),
 * POST_APPROVED (Post), HIGH_PERFORMANCE_POST (PostAnalytics,
 * triggerConfig.minImpressions/minLikes). L'événement déclencheur est passé en
 * entrée du run (prompt contextualisé + postId éventuel) — un run max par tick
 * et par automatisation pour éviter les rafales.
 *
 * NEW_PRODUCT reste non évalué (aucune source de données produit).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY = 86_400_000;
const TREND_KINDS: Record<string, string[]> = {
  NEW_TREND: ['TREND'],
  NEW_RSS_ITEM: ['RSS'],
  NEW_KEYWORD_HIT: ['KEYWORD', 'HASHTAG'],
};

/** Cherche l'événement le plus récent (postérieur au filigrane) pour un trigger. */
async function findTriggerEvent(
  a: Automation,
  since: Date,
): Promise<Record<string, unknown> | null> {
  const brandScope = a.brandId ? { brandId: a.brandId } : {};
  switch (a.triggerType) {
    case 'NEW_TREND':
    case 'NEW_RSS_ITEM':
    case 'NEW_KEYWORD_HIT': {
      const item = await db.trendItem.findFirst({
        where: {
          createdAt: { gt: since },
          trendWatch: { organizationId: a.organizationId, ...brandScope, kind: { in: TREND_KINDS[a.triggerType] as never } },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!item) return null;
      return {
        prompt:
          `Nouvelle tendance détectée par la veille : « ${item.title} »` +
          `${item.summary ? ` — ${item.summary.slice(0, 300)}` : ''}${item.url ? ` (${item.url})` : ''}. ` +
          'Crée un contenu qui exploite cette tendance pour la marque.',
        event: { type: a.triggerType, trendItemId: item.id, title: item.title },
      };
    }
    case 'NEW_COMPETITOR_POST': {
      const post = await db.competitorPost.findFirst({
        where: { createdAt: { gt: since }, competitor: { organizationId: a.organizationId, ...brandScope } },
        include: { competitor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (!post) return null;
      return {
        prompt:
          `Le concurrent « ${post.competitor.name} » vient de publier${post.caption ? ` : « ${post.caption.slice(0, 300)} »` : ''}. ` +
          'Prépare un contenu différenciant qui répond à ce mouvement.',
        event: { type: 'NEW_COMPETITOR_POST', competitorPostId: post.id, competitor: post.competitor.name },
      };
    }
    case 'POST_FAILED': {
      const sched = await db.postSchedule.findFirst({
        where: { status: 'FAILED', updatedAt: { gt: since }, post: { organizationId: a.organizationId, ...brandScope } },
        include: { post: { select: { id: true, title: true, body: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      if (!sched) return null;
      return {
        prompt:
          `La publication « ${sched.post.title ?? sched.post.body?.slice(0, 80) ?? sched.postId} » a échoué` +
          `${sched.errorMessage ? ` (${sched.errorMessage.slice(0, 160)})` : ''}. Propose une version corrigée.`,
        postId: sched.post.id,
        scheduleId: sched.id,
        event: { type: 'POST_FAILED', scheduleId: sched.id },
      };
    }
    case 'POST_APPROVED': {
      const post = await db.post.findFirst({
        where: { status: 'APPROVED', updatedAt: { gt: since }, organizationId: a.organizationId, ...brandScope },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, body: true },
      });
      if (!post) return null;
      return {
        prompt: `Le post « ${post.title ?? post.body?.slice(0, 80) ?? post.id} » vient d'être approuvé.`,
        postId: post.id,
        event: { type: 'POST_APPROVED', postId: post.id },
      };
    }
    case 'HIGH_PERFORMANCE_POST': {
      const cfg = (a.triggerConfig as { minImpressions?: number; minLikes?: number } | null) ?? {};
      const row = await db.postAnalytics.findFirst({
        where: {
          capturedAt: { gt: since },
          post: { organizationId: a.organizationId, ...brandScope },
          OR: [
            { impressions: { gte: cfg.minImpressions ?? 500 } },
            { likes: { gte: cfg.minLikes ?? 20 } },
          ],
        },
        include: { post: { select: { id: true, title: true, body: true } } },
        orderBy: { capturedAt: 'desc' },
      });
      if (!row) return null;
      return {
        prompt:
          `Le post « ${row.post.title ?? row.post.body?.slice(0, 80) ?? row.postId} » performe fortement ` +
          `(${row.impressions} impressions, ${row.likes} likes, ${row.comments} commentaires). ` +
          'Décline-le en nouveaux formats pour amplifier ce succès.',
        postId: row.post.id,
        event: { type: 'HIGH_PERFORMANCE_POST', postId: row.post.id, impressions: row.impressions, likes: row.likes },
      };
    }
    default:
      return null;
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const autos = await db.automation.findMany({
    where: {
      status: 'ACTIVE',
      triggerType: {
        in: [
          'DATE', 'FREQUENCY',
          'NEW_TREND', 'NEW_RSS_ITEM', 'NEW_KEYWORD_HIT',
          'NEW_COMPETITOR_POST', 'POST_FAILED', 'POST_APPROVED', 'HIGH_PERFORMANCE_POST',
        ],
      },
    },
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

    let due = false;
    let oneShot = false;
    let input: Record<string, unknown> = {};

    if (a.triggerType === 'DATE') {
      const cfg = (a.triggerConfig as { date?: string } | null) ?? {};
      const at = cfg.date ? new Date(cfg.date).getTime() : NaN;
      due = Number.isFinite(at) && at <= now && !last;
      oneShot = true;
    } else if (a.triggerType === 'FREQUENCY') {
      const cfg = (a.triggerConfig as { every?: string } | null) ?? {};
      // Marge de 5 % pour ne pas glisser d'un tick à chaque passage.
      const interval = (cfg.every === 'weekly' ? 7 * DAY : DAY) * 0.95;
      due = !last || now - new Date(last.createdAt).getTime() >= interval;
    } else {
      // Trigger événementiel — filigrane : dernier run, sinon activation.
      const since = last ? new Date(last.createdAt) : a.updatedAt;
      // eslint-disable-next-line no-await-in-loop
      const event = await findTriggerEvent(a, since);
      if (event) {
        due = true;
        input = event;
      }
    }

    if (!due) {
      results.push({ id: a.id, name: a.name, skipped: 'pas-encore-du' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await AutomationEngine.runById(a.id, input);
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
