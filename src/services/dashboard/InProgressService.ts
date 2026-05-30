import { db } from '@/lib/db';

export type InProgressPost = {
  id: string;
  title: string | null;
  format: string;
  brandName: string | null;
  hasMedia: boolean;
  scoreOverall: number | null;
  scheduleId: string | null;
  scheduledFor: Date | null;
  shareMode: string | null;
};

export type InProgressResult = { posts: InProgressPost[] };

export async function loadInProgressPosts(organizationId: string): Promise<InProgressResult> {
  const rows = await db.post.findMany({
    where: {
      organizationId,
      OR: [
        { status: 'SCHEDULED', schedules: { some: { shareMode: 'MANUAL' } } },
        { status: { in: ['DRAFT', 'AI_GENERATED', 'PENDING_APPROVAL'] } },
      ],
    },
    include: {
      _count: { select: { media: true } },
      brand: true,
      schedules: { where: { shareMode: 'MANUAL' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  });

  const posts: InProgressPost[] = rows.map((p) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const lastScore = (meta.lastScore ?? null) as { overall?: unknown } | null;
    const overallRaw = lastScore && typeof lastScore === 'object' ? lastScore.overall : null;
    const scoreOverall = typeof overallRaw === 'number' ? overallRaw : null;
    const schedule = p.schedules[0] ?? null;
    return {
      id: p.id,
      title: p.title,
      format: p.format,
      brandName: p.brand?.name ?? null,
      hasMedia: p._count.media > 0,
      scoreOverall,
      scheduleId: schedule?.id ?? null,
      scheduledFor: schedule?.scheduledFor ?? null,
      shareMode: schedule?.shareMode ?? null,
    };
  });

  return { posts };
}
