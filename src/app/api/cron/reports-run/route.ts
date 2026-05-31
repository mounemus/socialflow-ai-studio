import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ReportingService } from '@/services/reporting/ReportingService';

/**
 * Vercel Cron — scheduled report runner (daily at 08:00, the handler decides
 * which schedules are actually due).
 *
 *   1. Find every ReportSchedule that is enabled AND due (nextRunAt <= now).
 *   2. For each: materialize a Report from the schedule config, generate it,
 *      then advance the schedule (lastRunAt = now, nextRunAt = computeNextRun).
 *   3. Email delivery to recipients is out of scope here — we only log intent.
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

  const now = new Date();

  try {
    const dueSchedules = await db.reportSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      take: 100,
    });

    const results: Array<{
      scheduleId: string;
      reportId?: string;
      status: 'ok' | 'error';
      error?: string;
    }> = [];

    for (const schedule of dueSchedules) {
      try {
        // 1. Materialize a Report from the schedule's config.
        const report = await db.report.create({
          data: {
            organizationId: schedule.organizationId,
            brandId: schedule.brandId,
            title: schedule.title,
            period: schedule.period,
            sections: schedule.sections,
            whiteLabel: schedule.whiteLabel as never,
            scheduleId: schedule.id,
            status: 'DRAFT',
          },
        });

        // 2. Generate the report (gather data + AI summary, flips to READY/FAILED).
        await ReportingService.generateReport(report.id);

        // 3. Advance the schedule.
        const nextRunAt = ReportingService.computeNextRun(schedule.frequency, now);
        await db.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt,
            // ONCE schedules have no next run — disable so they don't re-trigger.
            ...(nextRunAt === null ? { enabled: false } : {}),
          },
        });

        // TODO: send the generated PDF to schedule.recipients via an email provider
        // (Resend/SES). Out of scope for this cron — log intent only.
        if (schedule.recipients.length > 0) {
          logger.info('Scheduled report ready — would email to recipients', {
            scheduleId: schedule.id,
            reportId: report.id,
            recipients: schedule.recipients,
          });
        }

        results.push({ scheduleId: schedule.id, reportId: report.id, status: 'ok' });
      } catch (err) {
        const message = (err as Error).message;
        logger.error('Scheduled report run failed', { scheduleId: schedule.id, err: message });
        results.push({ scheduleId: schedule.id, status: 'error', error: message });
      }
    }

    const summary = {
      due: dueSchedules.length,
      generated: results.filter((r) => r.status === 'ok').length,
      errors: results.filter((r) => r.status === 'error').length,
      results,
    };
    logger.info('Scheduled reports cron complete', summary);
    return NextResponse.json(summary);
  } catch (err) {
    logger.error('Scheduled reports cron failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
