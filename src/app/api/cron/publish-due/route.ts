import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { SocialPublisherService, buildPublishInputFromSchedule } from '@/services/publisher/SocialPublisherService';
import { SocialGatewayService } from '@/services/gateway/SocialGatewayService';
import type { GatewayId } from '@/services/gateway/types';

/**
 * Vercel Cron — toutes les 5 minutes. Sans worker BullMQ en prod, RIEN d'autre
 * ne scanne les schedules dus : c'est cette route qui fait tourner la
 * publication programmée.
 *
 *   1. DUE      : schedules SCHEDULED/QUEUED dont l'heure est passée → publie.
 *   2. STUCK    : schedules PROCESSING bloqués >10min → relit le statut côté
 *                 passerelle et finalise (même logique que le webhook Late).
 *   3. RETRY    : schedules FAILED récents (<24h) avec <3 tentatives → repasse.
 *
 * Secured by CRON_SECRET (Vercel sends Authorization: Bearer $CRON_SECRET).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DUE_TAKE = 20;
const STUCK_TAKE = 20;
const RETRY_TAKE = 10;
const STUCK_AFTER_MS = 10 * 60 * 1000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

type Detail = { scheduleId: string; outcome: string; error?: string };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const details: Detail[] = [];
  let published = 0;
  let finalized = 0;
  let retried = 0;
  let failed = 0;

  // --- 1. DUE ---------------------------------------------------------------
  const due = await db.postSchedule.findMany({
    where: {
      status: { in: ['SCHEDULED', 'QUEUED'] },
      scheduledFor: { lte: now },
      socialAccountId: { not: null },
    },
    include: { post: true },
    orderBy: { scheduledFor: 'asc' },
    take: DUE_TAKE,
  });
  for (const schedule of due) {
    try {
      const input = await buildPublishInputFromSchedule(schedule);
      const result = await SocialPublisherService.publishNow(input);
      if (result.success) published++;
      else failed++;
      details.push({ scheduleId: schedule.id, outcome: result.success ? 'published' : `failed:${result.error ?? ''}` });
    } catch (err) {
      failed++;
      const message = (err as Error).message;
      logger.error('cron publish-due: DUE item failed', { scheduleId: schedule.id, err: message });
      details.push({ scheduleId: schedule.id, outcome: 'error', error: message });
    }
  }

  // --- 2. STUCK (PROCESSING) -------------------------------------------------
  const stuck = await db.postSchedule.findMany({
    where: { status: 'PROCESSING', updatedAt: { lte: new Date(now.getTime() - STUCK_AFTER_MS) } },
    orderBy: { updatedAt: 'asc' },
    take: STUCK_TAKE,
  });
  for (const schedule of stuck) {
    try {
      const attempt = await db.publishAttempt.findFirst({
        where: { scheduleId: schedule.id },
        orderBy: { startedAt: 'desc' },
      });
      const response = (attempt?.response ?? null) as Record<string, unknown> | null;
      const gateway = (response?.gateway as GatewayId | undefined) ?? (attempt?.provider as GatewayId | undefined);
      const gatewayRef = response?.gatewayRef as string | undefined;
      if (!attempt || !gateway || !gatewayRef) {
        details.push({ scheduleId: schedule.id, outcome: 'stuck:no-gateway-ref' });
        continue;
      }
      const status = await SocialGatewayService.getPublicationStatus(gateway, gatewayRef);
      const result = await SocialGatewayService.finalizeSchedule(
        schedule.id,
        attempt.id,
        status,
        'Publication échouée (relecture après blocage PROCESSING).',
      );
      if (result.finalStatus !== 'PROCESSING') finalized++;
      details.push({ scheduleId: schedule.id, outcome: `stuck:${result.finalStatus}` });
    } catch (err) {
      const message = (err as Error).message;
      logger.error('cron publish-due: STUCK item failed', { scheduleId: schedule.id, err: message });
      details.push({ scheduleId: schedule.id, outcome: 'error', error: message });
    }
  }

  // --- 3. RETRY (FAILED) -----------------------------------------------------
  const retryable = await db.postSchedule.findMany({
    where: {
      status: 'FAILED',
      attempts: { lt: 3 },
      scheduledFor: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
      socialAccountId: { not: null },
    },
    include: { post: true },
    orderBy: { scheduledFor: 'asc' },
    take: RETRY_TAKE,
  });
  for (const schedule of retryable) {
    try {
      const input = await buildPublishInputFromSchedule(schedule);
      const result = await SocialPublisherService.publishNow(input);
      if (result.success) retried++;
      else failed++;
      details.push({ scheduleId: schedule.id, outcome: result.success ? 'retried' : `retry-failed:${result.error ?? ''}` });
    } catch (err) {
      failed++;
      const message = (err as Error).message;
      logger.error('cron publish-due: RETRY item failed', { scheduleId: schedule.id, err: message });
      details.push({ scheduleId: schedule.id, outcome: 'error', error: message });
    }
  }

  const summary = { ok: true, published, finalized, retried, failed, details };
  logger.info('cron publish-due complete', { published, finalized, retried, failed, due: due.length, stuck: stuck.length, retryable: retryable.length });
  return NextResponse.json(summary);
}
