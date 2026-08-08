/**
 * MentionAlertService — turns newly-polled brand mentions into actionable
 * MentionAlert rows and (optionally) dispatches them to Slack.
 *
 * Rules (see evaluateWatch):
 *   NEGATIVE_MENTION   — watch.alertOnNegative AND any new mention with
 *                        sentiment=NEGATIVE and sentimentScore <= -0.3
 *                        → CRITICAL, groups those mention ids.
 *   VOLUME_SPIKE       — watch.alertOnSpike AND count(last 24h) >= 3× the
 *                        trailing 7-day daily average AND >= 5 absolute
 *                        → WARNING.
 *   INFLUENCER_MENTION — any new mention with reach >= 10000
 *                        → INFO.
 *
 * De-duplication: we never raise the same alert type for the same mention ids
 * within a 6h window (checked against recent alerts of that type on the watch).
 *
 * Conventions mirror the rest of services/: object-literal, never throws on the
 * happy paths the cron depends on, db + logger imports.
 */
import type { MentionAlert, MentionWatch } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { NewMention } from './MentionListenerService';

const NEGATIVE_SCORE_THRESHOLD = -0.3;
const INFLUENCER_REACH_THRESHOLD = 10_000;
const SPIKE_MULTIPLIER = 3;
const SPIKE_MIN_ABSOLUTE = 5;
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h
const DAY_MS = 24 * 60 * 60 * 1000;

export interface EvaluateWatchResult {
  watchId: string;
  alerts: MentionAlert[];
  skipped: number; // suppressed by the 6h dedupe window
}

export interface ListAlertsArgs {
  orgId: string;
  acknowledged?: boolean;
  /** Scope marque active : alertes de cette marque + alertes sans marque. */
  brandId?: string | null;
}

export const MentionAlertService = {
  /**
   * Decide which alerts to raise for a watch after a poll. Persists MentionAlert
   * rows and returns them. Never throws — failures are logged and yield no alert.
   */
  async evaluateWatch(watchId: string, newMentions: NewMention[]): Promise<EvaluateWatchResult> {
    const empty: EvaluateWatchResult = { watchId, alerts: [], skipped: 0 };

    let watch: MentionWatch | null = null;
    try {
      watch = await db.mentionWatch.findUnique({ where: { id: watchId } });
    } catch (err) {
      logger.warn('MentionAlertService.evaluateWatch: load watch failed', {
        watchId,
        err: (err as Error).message,
      });
      return empty;
    }
    if (!watch) return empty;

    const created: MentionAlert[] = [];
    let skipped = 0;

    // ---- NEGATIVE_MENTION (CRITICAL) ----------------------------------------
    if (watch.alertOnNegative) {
      const negatives = newMentions.filter(
        (m) =>
          m.sentiment === 'NEGATIVE' &&
          typeof m.sentimentScore === 'number' &&
          m.sentimentScore <= NEGATIVE_SCORE_THRESHOLD,
      );
      if (negatives.length > 0) {
        const ids = negatives.map((m) => m.id);
        const dup = await this.hasRecentAlert(watchId, 'NEGATIVE_MENTION', ids);
        if (dup) {
          skipped += 1;
        } else {
          const worst = Math.min(...negatives.map((m) => m.sentimentScore ?? 0));
          const alert = await this.createAlert({
            watch,
            type: 'NEGATIVE_MENTION',
            severity: 'CRITICAL',
            title: `${negatives.length} negative mention${negatives.length > 1 ? 's' : ''} detected`,
            message: `Watch "${watch.name}" picked up ${negatives.length} negative mention${
              negatives.length > 1 ? 's' : ''
            } (worst score ${worst.toFixed(2)}). Review and respond.`,
            mentionIds: ids,
            meta: { worstScore: worst, count: negatives.length },
          });
          if (alert) created.push(alert);
        }
      }
    }

    // ---- VOLUME_SPIKE (WARNING) ---------------------------------------------
    if (watch.alertOnSpike) {
      const spike = await this.detectVolumeSpike(watchId);
      if (spike) {
        // Group the mentions that fall inside the 24h spike window.
        const ids = newMentions
          .filter((m) => Date.now() - m.publishedAt.getTime() <= DAY_MS)
          .map((m) => m.id);
        const dup = await this.hasRecentAlert(watchId, 'VOLUME_SPIKE', ids);
        if (dup) {
          skipped += 1;
        } else {
          const alert = await this.createAlert({
            watch,
            type: 'VOLUME_SPIKE',
            severity: 'WARNING',
            title: 'Mention volume spike',
            message: `Watch "${watch.name}" saw ${spike.last24h} mentions in the last 24h vs a ${spike.dailyAvg.toFixed(
              1,
            )}/day average (${spike.ratio.toFixed(1)}×).`,
            mentionIds: ids,
            meta: spike,
          });
          if (alert) created.push(alert);
        }
      }
    }

    // ---- INFLUENCER_MENTION (INFO) ------------------------------------------
    // Independent of toggles per spec ("if any new mention reach >= 10000").
    const influencers = newMentions.filter((m) => m.reach >= INFLUENCER_REACH_THRESHOLD);
    if (influencers.length > 0) {
      const ids = influencers.map((m) => m.id);
      const dup = await this.hasRecentAlert(watchId, 'INFLUENCER_MENTION', ids);
      if (dup) {
        skipped += 1;
      } else {
        const topReach = Math.max(...influencers.map((m) => m.reach));
        const alert = await this.createAlert({
          watch,
          type: 'INFLUENCER_MENTION',
          severity: 'INFO',
          title: 'Influencer mention',
          message: `Watch "${watch.name}" was mentioned by an account with ${topReach.toLocaleString()} reach.`,
          mentionIds: ids,
          meta: { topReach, count: influencers.length },
        });
        if (alert) created.push(alert);
      }
    }

    return { watchId, alerts: created, skipped };
  },

  /**
   * True if we already raised an alert of this type for an overlapping set of
   * mention ids within the last 6h.
   */
  async hasRecentAlert(
    watchId: string,
    type: MentionAlert['type'],
    mentionIds: string[],
  ): Promise<boolean> {
    if (mentionIds.length === 0) return false;
    try {
      const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
      const recent = await db.mentionAlert.findMany({
        where: { watchId, type, createdAt: { gte: since } },
        select: { mentionIds: true },
      });
      const idSet = new Set(mentionIds);
      return recent.some((a) => a.mentionIds.some((id) => idSet.has(id)));
    } catch (err) {
      logger.warn('MentionAlertService.hasRecentAlert failed', {
        watchId,
        type,
        err: (err as Error).message,
      });
      // Fail "not duplicate" so we don't silently swallow a real alert.
      return false;
    }
  },

  /**
   * Volume-spike heuristic: count mentions in the last 24h and compare to the
   * trailing 7-day daily average (days -8..-1, excluding the current 24h).
   * Spike when last24h >= 3× avg AND >= 5 absolute.
   */
  async detectVolumeSpike(
    watchId: string,
  ): Promise<{ last24h: number; dailyAvg: number; ratio: number } | null> {
    try {
      const now = Date.now();
      const last24hStart = new Date(now - DAY_MS);
      const trailingStart = new Date(now - 8 * DAY_MS);

      const [last24h, trailingTotal] = await Promise.all([
        db.brandMention.count({
          where: { watchId, publishedAt: { gte: last24hStart } },
        }),
        db.brandMention.count({
          where: { watchId, publishedAt: { gte: trailingStart, lt: last24hStart } },
        }),
      ]);

      if (last24h < SPIKE_MIN_ABSOLUTE) return null;

      const dailyAvg = trailingTotal / 7;
      // If there's no history, any burst >= the absolute floor counts as a spike.
      const ratio = dailyAvg > 0 ? last24h / dailyAvg : Infinity;
      if (ratio >= SPIKE_MULTIPLIER) {
        return { last24h, dailyAvg, ratio: Number.isFinite(ratio) ? ratio : last24h };
      }
      return null;
    } catch (err) {
      logger.warn('MentionAlertService.detectVolumeSpike failed', {
        watchId,
        err: (err as Error).message,
      });
      return null;
    }
  },

  /** Insert a MentionAlert row. Returns null on failure (logged). */
  async createAlert(args: {
    watch: MentionWatch;
    type: MentionAlert['type'];
    severity: MentionAlert['severity'];
    title: string;
    message: string;
    mentionIds: string[];
    meta?: Record<string, unknown>;
  }): Promise<MentionAlert | null> {
    try {
      return await db.mentionAlert.create({
        data: {
          organizationId: args.watch.organizationId,
          brandId: args.watch.brandId,
          watchId: args.watch.id,
          type: args.type,
          severity: args.severity,
          title: args.title,
          message: args.message,
          mentionIds: args.mentionIds,
        },
      });
    } catch (err) {
      logger.warn('MentionAlertService.createAlert failed', {
        watchId: args.watch.id,
        type: args.type,
        err: (err as Error).message,
      });
      return null;
    }
  },

  /**
   * POST a formatted alert to a Slack incoming webhook. Defensive: validates the
   * URL, has a hard timeout, and never throws. Returns true if Slack accepted it.
   */
  async dispatchSlack(alert: MentionAlert, webhookUrl: string | null | undefined): Promise<boolean> {
    if (!webhookUrl || !/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
      return false;
    }

    const emoji =
      alert.severity === 'CRITICAL' ? ':rotating_light:' : alert.severity === 'WARNING' ? ':warning:' : ':information_source:';
    const payload = {
      text: `${emoji} *${alert.title}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${alert.title}*\n${alert.message}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Severity: *${alert.severity}* · Type: \`${alert.type}\` · ${alert.mentionIds.length} mention(s)`,
            },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const ok = res.ok;
      if (!ok) {
        logger.warn('MentionAlertService.dispatchSlack: non-2xx from Slack', {
          alertId: alert.id,
          status: res.status,
        });
      }
      return ok;
    } catch (err) {
      logger.warn('MentionAlertService.dispatchSlack failed', {
        alertId: alert.id,
        err: (err as Error).message,
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  },

  /** List alerts for an org, newest first, optionally filtered by ack state and brand. */
  async listAlerts({ orgId, acknowledged, brandId }: ListAlertsArgs): Promise<MentionAlert[]> {
    try {
      return await db.mentionAlert.findMany({
        where: {
          organizationId: orgId,
          ...(typeof acknowledged === 'boolean' ? { acknowledged } : {}),
          ...(brandId ? { OR: [{ brandId }, { brandId: null }] } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (err) {
      logger.warn('MentionAlertService.listAlerts failed', {
        orgId,
        err: (err as Error).message,
      });
      return [];
    }
  },

  /** Acknowledge an alert. Returns the updated row, or null on failure. */
  async acknowledgeAlert(alertId: string, userId: string): Promise<MentionAlert | null> {
    try {
      return await db.mentionAlert.update({
        where: { id: alertId },
        data: {
          acknowledged: true,
          acknowledgedById: userId,
        },
      });
    } catch (err) {
      logger.warn('MentionAlertService.acknowledgeAlert failed', {
        alertId,
        err: (err as Error).message,
      });
      return null;
    }
  },
};
