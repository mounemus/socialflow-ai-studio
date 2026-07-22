import { db } from '@/lib/db';
import type { Mention, ListeningAlert, WatchLite } from './ListeningClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toIso(v: any): string {
  return (v instanceof Date ? v : new Date(v ?? Date.now())).toISOString();
}

/**
 * Hydratation serveur du Social Listening — extraite de la page /listening
 * pour être partagée avec /conversations (Refonte Phase C). Logique inchangée.
 */
export async function loadListeningData(orgId: string): Promise<{
  initialMentions: Mention[];
  alerts: ListeningAlert[];
  watches: WatchLite[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as unknown as Record<string, any>;

  const normSentiment = (s: unknown): Mention['sentiment'] => {
    const v = String(s ?? '').toUpperCase();
    if (v === 'POSITIVE') return 'POSITIVE';
    if (v === 'NEGATIVE') return 'NEGATIVE';
    return 'NEUTRAL';
  };

  let initialMentions: Mention[] = [];
  if (anyDb.brandMention && typeof anyDb.brandMention.findMany === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await anyDb.brandMention.findMany({
        where: { organizationId: orgId },
        orderBy: { publishedAt: 'desc' },
        take: 100,
        include: { watch: { select: { id: true, name: true } }, brand: { select: { name: true } } },
      });
      initialMentions = rows.map((r) => {
        const raw = (r.rawData && typeof r.rawData === 'object' ? r.rawData : {}) as Record<string, unknown>;
        const status = String(raw.status ?? 'NEW').toUpperCase();
        return {
          id: String(r.id),
          source: String(r.source ?? 'WEB').toUpperCase(),
          author: r.authorName ?? r.authorHandle ?? 'Anonyme',
          authorHandle: r.authorHandle ?? null,
          content: String(r.content ?? r.title ?? ''),
          url: r.url ?? null,
          sentiment: normSentiment(r.sentiment),
          relevance:
            typeof r.relevanceScore === 'number'
              ? r.relevanceScore
              : typeof r.sentimentScore === 'number'
                ? Math.abs(r.sentimentScore)
                : 0,
          status,
          publishedAt: toIso(r.publishedAt ?? r.createdAt),
          watchId: r.watchId ?? r.watch?.id ?? null,
          watchName: r.watch?.name ?? null,
          brandName: r.brand?.name ?? null,
        };
      });
    } catch {
      initialMentions = [];
    }
  }

  let alerts: ListeningAlert[] = [];
  if (anyDb.mentionAlert && typeof anyDb.mentionAlert.findMany === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await anyDb.mentionAlert.findMany({
        where: { organizationId: orgId, acknowledged: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      alerts = rows.map((r) => ({
        id: String(r.id),
        severity: String(r.severity ?? 'WARNING').toUpperCase() as ListeningAlert['severity'],
        title: String(r.title ?? r.message ?? 'Alerte de veille'),
        message: r.message ?? null,
        watchId: r.watchId ?? null,
        createdAt: toIso(r.createdAt),
      }));
    } catch {
      alerts = [];
    }
  }

  let watches: WatchLite[] = [];
  if (anyDb.mentionWatch && typeof anyDb.mentionWatch.findMany === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await anyDb.mentionWatch.findMany({
        where: { organizationId: orgId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, enabled: true },
      });
      watches = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? 'Veille'),
        active: r.enabled ?? true,
      }));
    } catch {
      watches = [];
    }
  }

  return { initialMentions, alerts, watches };
}
