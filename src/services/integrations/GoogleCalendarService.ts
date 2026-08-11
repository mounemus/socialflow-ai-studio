/**
 * GoogleCalendarService — synchronise les PostSchedule programmés vers
 * l'agenda Google (calendrier "primary" du compte Gmail connecté de l'org).
 *
 *   - Réutilise le même token Google que GoogleMailService (scope
 *     `calendar.events`, connexion partagée d'organisation) — pas de
 *     dépendance googleapis, appels REST directs.
 *   - Un événement (30 min) par PostSchedule SCHEDULED, tracé par
 *     PostSchedule.googleEventId ; PATCH idempotent si déjà créé, DELETE
 *     (404 toléré) si le schedule n'est plus programmé.
 *
 * Jamais de throw — chaque schedule est traité isolément, une erreur ne
 * bloque pas les suivants.
 */
import type { PostStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { GoogleMailService } from './GoogleMailService';

const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const EVENT_DURATION_MS = 30 * 60 * 1000;
const SYNC_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours
const ACTIVE_STATUSES: PostStatus[] = ['SCHEDULED', 'QUEUED'];

export interface CalendarSyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  reasons: Record<string, number>;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://socialflow-ai-studio.vercel.app').replace(/\/$/, '');
}

function eventBody(schedule: {
  id: string;
  postId: string;
  scheduledFor: Date;
  post: { title: string | null; body: string | null } | null;
  socialAccount: { platform: string } | null;
}) {
  const platform = schedule.socialAccount?.platform ?? 'manuel';
  const title = schedule.post?.title ?? 'Publication';
  const excerpt = (schedule.post?.body ?? '').slice(0, 200);
  const start = schedule.scheduledFor;
  const end = new Date(start.getTime() + EVENT_DURATION_MS);
  return {
    summary: `📣 ${title} (${platform})`,
    description: [excerpt, `${appUrl()}/posts/${schedule.postId}`].filter(Boolean).join('\n\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { socialflowScheduleId: schedule.id } },
  };
}

export const GoogleCalendarService = {
  async syncForOrganization(organizationId: string): Promise<CalendarSyncResult> {
    const out: CalendarSyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0, reasons: {} };
    const bump = (r: string) => {
      out.reasons[r] = (out.reasons[r] ?? 0) + 1;
    };

    const token = await GoogleMailService.getAccessToken(organizationId);
    if (!token) {
      bump('gmail-non-connecte');
      return out;
    }

    const now = new Date();
    const windowEnd = new Date(now.getTime() + SYNC_WINDOW_MS);

    // --- Créer / mettre à jour les schedules encore programmés -------------
    let due: Array<{
      id: string;
      postId: string;
      scheduledFor: Date;
      googleEventId: string | null;
      post: { title: string | null; body: string | null } | null;
      socialAccount: { platform: string } | null;
    }> = [];
    try {
      due = await db.postSchedule.findMany({
        where: {
          status: { in: ACTIVE_STATUSES },
          scheduledFor: { gte: now, lte: windowEnd },
          post: { organizationId },
        },
        include: { post: { select: { title: true, body: true } }, socialAccount: { select: { platform: true } } },
      });
    } catch (err) {
      logger.warn('GoogleCalendarService: chargement schedules dus échoué', { organizationId, err: (err as Error).message });
      bump('chargement-schedules-echoue');
      return out;
    }

    for (const schedule of due) {
      try {
        const body = eventBody(schedule);
        if (!schedule.googleEventId) {
          const res = await fetch(CALENDAR_EVENTS_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
          if (!res.ok || !json.id) {
            out.skipped++;
            bump('creation-event-echouee');
            logger.warn('GoogleCalendarService: création event échouée', {
              scheduleId: schedule.id,
              error: json.error?.message,
            });
            continue;
          }
          await db.postSchedule.update({ where: { id: schedule.id }, data: { googleEventId: json.id } });
          out.created++;
        } else {
          // PATCH systématique — idempotent, évite un GET de comparaison.
          const res = await fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(schedule.googleEventId)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            out.skipped++;
            bump('mise-a-jour-event-echouee');
            continue;
          }
          out.updated++;
        }
      } catch (err) {
        out.skipped++;
        bump('sync-event-exception');
        logger.warn('GoogleCalendarService: sync event échoué', { scheduleId: schedule.id, err: (err as Error).message });
      }
    }

    // --- Supprimer les événements des schedules qui ne sont plus programmés -
    let toRemove: Array<{ id: string; googleEventId: string | null }> = [];
    try {
      toRemove = await db.postSchedule.findMany({
        where: {
          googleEventId: { not: null },
          status: { notIn: ACTIVE_STATUSES },
          post: { organizationId },
        },
        select: { id: true, googleEventId: true },
      });
    } catch (err) {
      logger.warn('GoogleCalendarService: chargement schedules à retirer échoué', { organizationId, err: (err as Error).message });
      bump('chargement-a-retirer-echoue');
      return out;
    }

    for (const schedule of toRemove) {
      try {
        const res = await fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(schedule.googleEventId!)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          out.skipped++;
          bump('suppression-event-echouee');
          continue;
        }
        await db.postSchedule.update({ where: { id: schedule.id }, data: { googleEventId: null } });
        out.deleted++;
      } catch (err) {
        out.skipped++;
        bump('suppression-event-exception');
        logger.warn('GoogleCalendarService: suppression event échouée', { scheduleId: schedule.id, err: (err as Error).message });
      }
    }

    logger.info('GoogleCalendarService.summary', { organizationId, ...out });
    return out;
  },
};
