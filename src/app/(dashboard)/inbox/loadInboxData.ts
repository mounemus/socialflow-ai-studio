import { db } from '@/lib/db';
import type { Interaction, TeamMemberLite } from './InboxClient';

/**
 * Hydratation serveur de la boîte de réception — extraite de la page /inbox
 * pour être partagée avec /conversations (Refonte Phase C). Logique inchangée.
 */
export async function loadInboxData(orgId: string): Promise<{
  initialInteractions: Interaction[];
  teamMembers: TeamMemberLite[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as unknown as Record<string, any>;
  let initialInteractions: Interaction[] = [];
  if (anyDb.interaction && typeof anyDb.interaction.findMany === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await anyDb.interaction.findMany({
        where: { organizationId: orgId },
        orderBy: { receivedAt: 'desc' },
        take: 50,
        include: { brand: true, post: true, assignee: true, thread: true },
      });
      initialInteractions = rows.map((r) => ({
        id: String(r.id),
        platform: String(r.platform ?? 'UNKNOWN'),
        kind: String(r.kind ?? r.type ?? 'COMMENT'),
        fromName: r.fromName ?? r.authorName ?? 'Inconnu',
        fromHandle: r.fromHandle ?? r.authorHandle ?? null,
        avatarUrl: r.avatarUrl ?? r.authorAvatarUrl ?? null,
        content: String(r.content ?? r.body ?? ''),
        sentiment: (r.sentiment ?? null) as Interaction['sentiment'],
        status: String(r.status ?? 'NEW'),
        isUnread: r.isUnread ?? r.status === 'NEW',
        isAutoReplied: Boolean(r.isAutoReplied),
        receivedAt: (r.receivedAt instanceof Date
          ? r.receivedAt
          : new Date(r.receivedAt ?? Date.now())
        ).toISOString(),
        brandId: r.brandId ?? null,
        brandName: r.brand?.name ?? null,
        postId: r.postId ?? null,
        postTitle: r.post?.title ?? (r.post?.body ? String(r.post.body).slice(0, 40) : null),
        assigneeId: r.assigneeId ?? null,
        assigneeName: r.assignee?.user?.name ?? r.assignee?.name ?? null,
        threadId: r.threadId ?? r.thread?.id ?? null,
      }));
    } catch {
      initialInteractions = [];
    }
  }

  const teamRows = await db.teamMember.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const teamMembers: TeamMemberLite[] = teamRows.map((t) => ({
    id: t.id,
    userId: t.userId,
    name: t.user?.name ?? t.user?.email ?? 'Membre',
    email: t.user?.email ?? null,
  }));

  return { initialInteractions, teamMembers };
}
