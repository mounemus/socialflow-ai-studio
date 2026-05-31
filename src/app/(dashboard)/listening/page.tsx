import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import {
  ListeningClient,
  type Mention,
  type ListeningAlert,
  type WatchLite,
} from './ListeningClient';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toIso(v: any): string {
  return (v instanceof Date ? v : new Date(v ?? Date.now())).toISOString();
}

export default async function ListeningPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;
  const orgId = membership.organizationId;

  // The Mention / MentionWatch / ListeningAlert models are not guaranteed to be
  // present in the generated Prisma client yet (they are declared as relations
  // but the concrete models may land later). We do a defensive dynamic lookup so
  // this page lights up automatically once the models exist, and fall back to
  // empty data otherwise. Same pattern as the inbox page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as unknown as Record<string, any>;

  // Normalize Prisma's InteractionSentiment (POSITIVE/NEGATIVE/NEUTRAL/SPAM/UNKNOWN)
  // down to the 3-way UI sentiment.
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
        // No dedicated status column on BrandMention — track it inside rawData.
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

  return (
    <ListeningClient
      initialMentions={initialMentions}
      initialAlerts={alerts}
      watches={watches}
    />
  );
}
