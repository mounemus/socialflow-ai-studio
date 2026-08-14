import { handle, ok } from '@/lib/api';
import { resolveScheduleContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';
import { SocialPublisherService, buildPublishInputFromSchedule } from '@/services/publisher/SocialPublisherService';
import { db } from '@/lib/db';

/**
 * « Republier » manuel — repasse le même chemin de publication que le cron
 * de rattrapage (/api/cron/publish-due) pour un schedule FAILED ou
 * ACTION_REQUIRED précis.
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role, schedule } = await resolveScheduleContext(id);
  requirePermission(role, 'post.edit');

  if (schedule.status !== 'FAILED' && schedule.status !== 'ACTION_REQUIRED') {
    throw new ForbiddenError('Seul un créneau en échec ou en action requise peut être republié.');
  }
  // ACTION_REQUIRED avec identifiant externe = la publication est DÉJÀ en
  // ligne (succès non vérifié). Republier créerait un doublon réel sur le
  // compte du client.
  if (schedule.status === 'ACTION_REQUIRED' && schedule.externalPostId) {
    throw new ForbiddenError(
      'Cette publication est déjà partie sur le réseau (identifiant externe présent) — vérifie-la sur place au lieu de republier.',
    );
  }
  if (schedule.attempts >= 5) {
    throw new ForbiddenError(
      'Plafond de tentatives atteint (5) — corrige la cause de l’échec avant de relancer.',
    );
  }

  const input = await buildPublishInputFromSchedule(schedule);
  const result = await SocialPublisherService.publishNow(input, { claimedByCaller: true });
  const updated = await db.postSchedule.findUnique({ where: { id } });

  return ok({ schedule: updated, result });
});
