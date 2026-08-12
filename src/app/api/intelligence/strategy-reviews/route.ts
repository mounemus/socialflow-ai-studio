import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

/**
 * GET /api/intelligence/strategy-reviews — dernières revues hebdomadaires de
 * stratégie (écrites chaque lundi par le cron strategy-review). C'est la sortie
 * de la boucle apprenante : jusqu'ici les revues étaient écrites en base sans
 * qu'aucune page ne les affiche.
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const strategies = await db.marketingStrategy.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, title: true, strategy: true, brand: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  const reviews = strategies
    .map((s) => {
      const json = (s.strategy as Record<string, unknown> | null) ?? {};
      const review = json._latestReview as Record<string, unknown> | undefined;
      return review
        ? { strategyId: s.id, strategyTitle: s.title, brandName: s.brand?.name ?? null, review }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return ok({ reviews });
});
