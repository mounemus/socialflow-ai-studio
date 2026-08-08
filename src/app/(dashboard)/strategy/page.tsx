import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Target } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * /strategy — accès direct à la stratégie de la MARQUE ACTIVE.
 * Marque active sélectionnée → redirection vers son atelier stratégie.
 * Sinon → liste des marques avec leurs stratégies pour choisir.
 */
export default async function StrategyIndexPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const activeBrandId = await getActiveBrandId(membership.organizationId);
  if (activeBrandId) redirect(`/brands/${activeBrandId}/strategy`);

  const brands = await db.brand.findMany({
    where: { organizationId: membership.organizationId },
    select: {
      id: true,
      name: true,
      strategies: {
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stratégies</h1>
        <p className="text-sm text-muted-foreground">
          Choisis une marque — ou sélectionne une marque active en haut de la barre latérale pour un accès direct.
        </p>
      </div>
      {brands.length === 0 ? (
        <EmptyState icon={<Target className="h-10 w-10" />} title="Aucune marque" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.id}/strategy`}>
              <Card className="h-full transition-colors hover:border-brand-400">
                <CardHeader>
                  <CardTitle className="text-base">{b.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  {b.strategies.length === 0 ? (
                    <p>Aucune stratégie — cliquer pour en générer une.</p>
                  ) : (
                    b.strategies.map((s) => (
                      <p key={s.id} className="flex items-center gap-2 truncate">
                        <Badge variant={s.status === 'VALIDATED' || s.status === 'IN_EXECUTION' ? 'success' : 'secondary'}>
                          {s.status === 'DRAFT' ? 'Brouillon'
                            : s.status === 'VALIDATED' ? 'Validée'
                            : s.status === 'IN_EXECUTION' ? 'En exécution' : 'Archivée'}
                        </Badge>
                        <span className="truncate">{s.title}</span>
                      </p>
                    ))
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
