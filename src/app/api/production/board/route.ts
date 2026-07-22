import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/production/board — la File de production (Refonte Phase B).
 *
 * Renvoie les posts de l'organisation (filtrés par la marque active du
 * contexte global) sous forme de cartes légères pour le kanban : identité,
 * étape du cycle de vie, score qualité, prochaine planification, demande de
 * validation en attente. Sélection stricte — jamais les colonnes lourdes
 * (body complet tronqué côté serveur, metadata réduit au score).
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const activeBrandId = await getActiveBrandId(ctx.organizationId);

  const posts = await db.post.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(activeBrandId ? { brandId: activeBrandId } : {}),
      status: { not: 'ARCHIVED' },
    },
    select: {
      id: true,
      title: true,
      body: true,
      status: true,
      format: true,
      updatedAt: true,
      metadata: true,
      brand: { select: { id: true, name: true } },
      _count: { select: { media: true } },
      schedules: {
        select: { scheduledFor: true, status: true },
        orderBy: { scheduledFor: 'asc' },
        take: 1,
      },
      approvals: {
        where: { status: { in: ['PENDING', 'IN_REVIEW'] } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 250,
  });

  const cards = posts.map((p) => {
    const meta = (p.metadata as Record<string, unknown> | null) ?? {};
    const lastScore =
      (meta.lastScore as { overall?: number; verdict?: string } | undefined) ?? null;
    return {
      id: p.id,
      title: p.title?.trim() || (p.body ?? '').slice(0, 60) || 'Sans titre',
      excerpt: (p.body ?? '').slice(0, 140),
      status: p.status,
      format: p.format,
      updatedAt: p.updatedAt.toISOString(),
      brand: p.brand,
      mediaCount: p._count.media,
      score: lastScore?.overall ?? null,
      scoreVerdict: lastScore?.verdict ?? null,
      nextScheduleAt: p.schedules[0]?.scheduledFor?.toISOString() ?? null,
      pendingApprovalId: p.approvals[0]?.id ?? null,
    };
  });

  return ok({ cards, activeBrandId });
});
