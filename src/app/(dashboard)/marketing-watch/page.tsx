import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Radar, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function WatchPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const watches = await db.trendWatch.findMany({
    where: { organizationId: membership.organizationId },
    include: { items: { orderBy: { createdAt: 'desc' }, take: 5 }, _count: { select: { items: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Veille marketing</h1>
          <p className="text-sm text-muted-foreground">Tendances, hashtags, RSS, mots-clés — scorés par opportunité.</p>
        </div>
        <Link href="/marketing-watch/new">
          <Button variant="brand"><Plus className="mr-2 h-4 w-4" /> Nouvelle veille</Button>
        </Link>
      </div>

      {watches.length === 0 ? (
        <EmptyState
          icon={<Radar className="h-10 w-10" />}
          title="Aucune veille active"
          description="Crée une veille RSS, hashtag ou tendance pour alimenter ton inspiration."
          action={<Link href="/marketing-watch/new"><Button variant="brand">Créer une veille</Button></Link>}
        />
      ) : (
        <div className="space-y-4">
          {watches.map((w) => (
            <Card key={w.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm">
                  <span>{w.name}</span>
                  <div className="flex gap-2">
                    <Badge variant="info">{w.kind}</Badge>
                    <Badge variant={w.active ? 'success' : 'secondary'}>{w.active ? 'Actif' : 'Pause'}</Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{w._count.items} item{w._count.items > 1 ? 's' : ''} collecté{w._count.items > 1 ? 's' : ''}</p>
                {w.items.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {w.items.map((it) => (
                      <li key={it.id} className="text-xs">
                        <a href={it.url ?? '#'} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                          {it.title}
                        </a>
                        {it.contentOpportunityScore != null ? (
                          <span className="ml-2 text-[10px] text-emerald-600">opportunité {(it.contentOpportunityScore * 100).toFixed(0)}%</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
