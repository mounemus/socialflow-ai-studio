import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getActiveBrandId } from '@/lib/tenant';
import { normalizeMention, normalizeAlert } from '@/lib/inbox-normalize';
import type { Mention, ListeningAlert, WatchLite } from './ListeningClient';

/**
 * Hydratation serveur du Social Listening — extraite de la page /listening
 * pour être partagée avec /conversations (Refonte Phase C).
 *
 * Scopée sur la marque active (les lignes sans marque restent visibles) ;
 * mentions/alertes normalisées via inbox-normalize — même shape que le poller.
 */
export async function loadListeningData(orgId: string): Promise<{
  initialMentions: Mention[];
  alerts: ListeningAlert[];
  watches: WatchLite[];
}> {
  const activeBrandId = await getActiveBrandId(orgId);
  const brandScope = activeBrandId
    ? { OR: [{ brandId: activeBrandId }, { brandId: null }] }
    : {};

  let initialMentions: Mention[] = [];
  try {
    const rows = await db.brandMention.findMany({
      where: { organizationId: orgId, ...brandScope },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      include: { watch: { select: { id: true, name: true } }, brand: { select: { name: true } } },
    });
    initialMentions = rows.map(normalizeMention);
  } catch (err) {
    logger.error('loadListeningData: brandMention.findMany failed', {
      orgId,
      err: (err as Error).message,
    });
    initialMentions = [];
  }

  let alerts: ListeningAlert[] = [];
  try {
    const rows = await db.mentionAlert.findMany({
      where: { organizationId: orgId, acknowledged: false, ...brandScope },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    alerts = rows.map(normalizeAlert);
  } catch (err) {
    logger.error('loadListeningData: mentionAlert.findMany failed', {
      orgId,
      err: (err as Error).message,
    });
    alerts = [];
  }

  let watches: WatchLite[] = [];
  try {
    const rows = await db.mentionWatch.findMany({
      where: { organizationId: orgId, ...brandScope },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, enabled: true },
    });
    watches = rows.map((r) => ({
      id: r.id,
      name: r.name ?? 'Veille',
      active: r.enabled ?? true,
    }));
  } catch (err) {
    logger.error('loadListeningData: mentionWatch.findMany failed', {
      orgId,
      err: (err as Error).message,
    });
    watches = [];
  }

  return { initialMentions, alerts, watches };
}
