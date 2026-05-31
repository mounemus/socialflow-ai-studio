import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { WatchesClient, type WatchConfig, type BrandLite } from './WatchesClient';

export const dynamic = 'force-dynamic';

export default async function ListeningWatchesPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;
  const orgId = membership.organizationId;

  const brandRows = await db.brand.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  const brands: BrandLite[] = brandRows.map((b) => ({ id: b.id, name: b.name }));

  // Defensive dynamic lookup — MentionWatch may not be in the generated client yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as unknown as Record<string, any>;
  let watches: WatchConfig[] = [];
  if (anyDb.mentionWatch && typeof anyDb.mentionWatch.findMany === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await anyDb.mentionWatch.findMany({
        where: { organizationId: orgId },
        orderBy: { updatedAt: 'desc' },
        include: { brand: { select: { id: true, name: true } }, _count: { select: { mentions: true } } },
      });
      watches = rows.map((r) => {
        // minRelevance isn't a dedicated column — it lives inside `config` JSON.
        const cfg = (r.config && typeof r.config === 'object' ? r.config : {}) as Record<string, unknown>;
        const minRel = typeof cfg.minRelevance === 'number' ? cfg.minRelevance : 0.5;
        return {
          id: String(r.id),
          name: String(r.name ?? 'Veille'),
          brandId: r.brandId ?? null,
          brandName: r.brand?.name ?? null,
          keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
          excludeKeywords: Array.isArray(r.excludeKeywords) ? r.excludeKeywords.map(String) : [],
          sources: Array.isArray(r.sources) ? r.sources.map(String) : ['WEB'],
          minRelevance: minRel,
          alertOnNegative: Boolean(r.alertOnNegative),
          alertOnSpike: Boolean(r.alertOnSpike),
          slackWebhookUrl: r.slackWebhookUrl ?? null,
          active: r.enabled ?? true,
          mentionCount:
            typeof r._count?.mentions === 'number'
              ? r._count.mentions
              : 0,
        };
      });
    } catch {
      watches = [];
    }
  }

  return <WatchesClient initialWatches={watches} brands={brands} />;
}
