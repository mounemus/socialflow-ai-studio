import Link from 'next/link';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { auth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Building2, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function BrandsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const brands = await db.brand.findMany({
    where: { organizationId: membership.organizationId },
    include: { profile: true, _count: { select: { posts: true, socialAccounts: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marques</h1>
          <p className="text-sm text-muted-foreground">Chaque marque a son propre profil, sa charte, ses comptes et ses campagnes.</p>
        </div>
        <Link href="/brands/new">
          <Button variant="brand"><Plus className="mr-2 h-4 w-4" /> Nouvelle marque</Button>
        </Link>
      </div>

      {brands.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="Aucune marque pour l'instant"
          description="Crée ta première marque pour commencer à générer du contenu cohérent."
          action={<Link href="/brands/new"><Button variant="brand">Créer une marque</Button></Link>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle>{b.name}</CardTitle>
                  <CardDescription>{b.industry ?? 'Pas d\'industrie définie'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    {b._count.posts} publication{b._count.posts > 1 ? 's' : ''} ·{' '}
                    {b._count.socialAccounts} compte{b._count.socialAccounts > 1 ? 's' : ''} social
                  </div>
                  {b.profile?.toneOfVoice ? (
                    <div className="mt-2 text-xs text-slate-500">Ton : {b.profile.toneOfVoice}</div>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
