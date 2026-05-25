import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Users, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const comps = await db.competitor.findMany({
    where: { organizationId: membership.organizationId },
    include: { socialAccounts: true, _count: { select: { posts: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Concurrents</h1>
          <p className="text-sm text-muted-foreground">Suivi, SWOT et recommandations IA.</p>
        </div>
        <Link href="/competitors/new"><Button variant="brand"><Plus className="mr-2 h-4 w-4" /> Nouveau</Button></Link>
      </div>

      {comps.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="Aucun concurrent suivi"
          description="Ajoute tes concurrents pour comparer cadence, ton et opportunités."
          action={<Link href="/competitors/new"><Button variant="brand">Ajouter</Button></Link>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {comps.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="text-muted-foreground">{c.industry ?? '—'} · {c.country ?? '—'}</div>
                {c.website ? <a className="text-brand-600 hover:underline" href={c.website} target="_blank" rel="noopener noreferrer">{c.website}</a> : null}
                <div className="text-xs text-slate-500">{c._count.posts} post{c._count.posts > 1 ? 's' : ''} suivis</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
