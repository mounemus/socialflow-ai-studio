import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { can } from '@/lib/rbac';
import { ApprovalsClient, type ApprovalItem } from './ApprovalsClient';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  // Contexte de marque global : les validations suivent la marque active
  // (filtrées via le post lié — une demande sans post reste visible en mode
  // « Toutes les marques » uniquement).
  const activeBrandId = await getActiveBrandId(membership.organizationId);
  const rows = await db.approvalRequest.findMany({
    where: {
      organizationId: membership.organizationId,
      ...(activeBrandId ? { post: { brandId: activeBrandId } } : {}),
    },
    include: {
      post: { include: { brand: { select: { id: true, name: true, logo: true } } } },
      comments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Resolve requester display names in one round-trip.
  const requesterIds = Array.from(
    new Set(rows.map((r) => r.requestedBy).filter((v): v is string => Boolean(v))),
  );
  const requesters = requesterIds.length
    ? await db.user.findMany({
        where: { id: { in: requesterIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const requesterById = new Map(requesters.map((u) => [u.id, u]));

  const items: ApprovalItem[] = rows.map((r) => {
    const requester = r.requestedBy ? requesterById.get(r.requestedBy) : undefined;
    const excerpt = (r.post.body ?? '').trim();
    return {
      id: r.id,
      status: r.status,
      message: r.message,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      requesterName: requester?.name ?? requester?.email ?? r.reviewerEmail ?? null,
      commentsCount: r.comments.length,
      post: {
        id: r.post.id,
        title: r.post.title ?? null,
        format: r.post.format,
        brandName: r.post.brand?.name ?? null,
        excerpt: excerpt.length > 320 ? `${excerpt.slice(0, 320)}…` : excerpt,
      },
    };
  });

  const role = membership.role;
  const canApprove = can(role, 'post.approve');

  return <ApprovalsClient items={items} role={role} canApprove={canApprove} />;
}
