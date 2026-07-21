import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Megaphone, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const items = await db.campaign.findMany({
    where: { organizationId: membership.organizationId },
    include: { brand: true, _count: { select: { posts: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campagnes</h1>
          <p className="text-sm text-muted-foreground">Regroupe tes publications par campagne et objectif.</p>
        </div>
        <Link href="/campaigns"><Button variant="brand"><Plus className="mr-2 h-4 w-4" /> Nouvelle campagne</Button></Link>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Megaphone className="h-10 w-10" />} title="Aucune campagne" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{c.name}</span>
                  <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>{c.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>{c.brand?.name ?? 'Sans marque'} · {c._count.posts} post{c._count.posts > 1 ? 's' : ''}</p>
                {c.objective ? <p className="mt-1">Objectif: {c.objective}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
