import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { InboxClient, type Interaction, type TeamMemberLite } from './InboxClient';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;
  const orgId = membership.organizationId;

  // The Interaction model is not yet present in Prisma. We attempt a dynamic
  // lookup (so this page lights up automatically once `db.interaction` exists)
  // and fall back to an empty list otherwise. The shape below mirrors the
  // expected schema (see InboxClient.Interaction).
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
        receivedAt: (r.receivedAt instanceof Date ? r.receivedAt : new Date(r.receivedAt ?? Date.now())).toISOString(),
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

  return <InboxClient initialInteractions={initialInteractions} teamMembers={teamMembers} />;
}
