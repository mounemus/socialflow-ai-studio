import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { IntelligentWatchService } from '@/services/watch/IntelligentWatchService';
import { WatchClient, type SerializedReport } from './WatchClient';

export const dynamic = 'force-dynamic';

export default async function WatchPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const brandId = await getActiveBrandId(membership.organizationId);
  const brand = brandId ? await db.brand.findFirst({ where: { id: brandId } }) : null;

  const reports = await db.watchReport.findMany({
    where: { organizationId: membership.organizationId, kind: { in: ['MARKET', 'COMPETITION', 'PRICING'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const feeds = await db.trendWatch.count({ where: { organizationId: membership.organizationId } });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Veille intelligente</h1>
          <p className="text-sm text-muted-foreground">
            Marché & tendances, concurrence, prix — l’IA observe le web avec le contexte de ta marque et produit des rapports sourcés.
          </p>
        </div>
        <Link href="/marketing-watch/new">
          <Button variant="outline" size="sm"><Plus className="mr-2 h-4 w-4" /> Flux classique (RSS/hashtag){feeds ? ` — ${feeds}` : ''}</Button>
        </Link>
      </div>

      <WatchClient
        brandName={brand?.name ?? null}
        configured={IntelligentWatchService.isConfigured()}
        reports={reports.map((r): SerializedReport => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          createdAt: r.createdAt.toISOString(),
          content: r.content as SerializedReport['content'],
          sources: (r.sources as SerializedReport['sources']) ?? [],
        }))}
      />
    </div>
  );
}
