/**
 * Normalisation partagée inbox / listening — transforme les lignes Prisma
 * (SocialInteraction, BrandMention, MentionAlert) vers les shapes attendues
 * par les clients. Pur (aucun accès DB) : utilisé côté serveur (loaders) ET
 * côté client (pollers 30 s), pour que les deux chemins produisent
 * exactement la même forme.
 */
import type { Interaction } from '@/app/(dashboard)/inbox/InboxClient';
import type { Mention, ListeningAlert } from '@/app/(dashboard)/listening/ListeningClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toIso(v: unknown): string {
  const d = v instanceof Date ? v : new Date((v as string | number | undefined) ?? Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Ligne SocialInteraction (avec includes brand/post/assignedTo) → shape client. */
export function normalizeInteraction(r: Row): Interaction {
  const status = String(r.status ?? 'NEW');
  const s = String(r.sentiment ?? '').toUpperCase();
  // UNKNOWN / SPAM (et toute valeur inattendue) → null côté client.
  const sentiment: Interaction['sentiment'] =
    s === 'POSITIVE' || s === 'NEGATIVE' || s === 'NEUTRAL'
      ? (s as Interaction['sentiment'])
      : null;
  return {
    id: String(r.id),
    platform: String(r.platform ?? 'UNKNOWN'),
    kind: String(r.kind ?? r.type ?? 'COMMENT'),
    fromName: r.fromName ?? r.fromHandle ?? 'Inconnu',
    fromHandle: r.fromHandle ?? null,
    avatarUrl: r.avatarUrl ?? r.fromAvatarUrl ?? null,
    content: String(r.content ?? ''),
    sentiment,
    status,
    isUnread: r.isUnread ?? status === 'NEW',
    isAutoReplied: Boolean(r.isAutoReplied),
    receivedAt: toIso(r.receivedAt),
    brandId: r.brandId ?? null,
    brandName: r.brand?.name ?? null,
    postId: r.postId ?? null,
    postTitle: r.post?.title ?? null,
    // assignedToId référence un User (relation assignedTo).
    assigneeId: r.assigneeId ?? r.assignedToId ?? null,
    assigneeName: r.assigneeName ?? r.assignedTo?.name ?? r.assignedTo?.email ?? null,
    threadId: r.threadId ?? null,
  };
}

/** Ligne BrandMention (avec includes watch/brand) → shape client. */
export function normalizeMention(r: Row): Mention {
  const s = String(r.sentiment ?? '').toUpperCase();
  // Colonne MentionStatus (NEW|REVIEWED|RESPONDED|IGNORED) → statut client (NEW|PROCESSED|IGNORED).
  const rawStatus = String(r.status ?? 'NEW').toUpperCase();
  return {
    id: String(r.id),
    source: String(r.source ?? 'WEB').toUpperCase(),
    author: r.authorName ?? r.authorHandle ?? 'Anonyme',
    authorHandle: r.authorHandle ?? null,
    content: String(r.content ?? r.title ?? ''),
    url: r.url ?? null,
    sentiment: s === 'POSITIVE' ? 'POSITIVE' : s === 'NEGATIVE' ? 'NEGATIVE' : 'NEUTRAL',
    relevance:
      typeof r.relevanceScore === 'number'
        ? r.relevanceScore
        : typeof r.sentimentScore === 'number'
          ? Math.abs(r.sentimentScore)
          : 0,
    status: rawStatus === 'REVIEWED' || rawStatus === 'RESPONDED' ? 'PROCESSED' : rawStatus,
    publishedAt: toIso(r.publishedAt ?? r.ingestedAt ?? r.createdAt),
    watchId: r.watchId ?? r.watch?.id ?? null,
    watchName: r.watch?.name ?? null,
    brandName: r.brand?.name ?? null,
  };
}

/** Ligne MentionAlert → shape client. */
export function normalizeAlert(r: Row): ListeningAlert {
  const sev = String(r.severity ?? 'WARNING').toUpperCase();
  return {
    id: String(r.id),
    severity: (sev === 'CRITICAL' || sev === 'INFO' ? sev : 'WARNING') as ListeningAlert['severity'],
    title: String(r.title ?? r.message ?? 'Alerte de veille'),
    message: r.message ?? null,
    watchId: r.watchId ?? null,
    createdAt: toIso(r.createdAt),
  };
}
