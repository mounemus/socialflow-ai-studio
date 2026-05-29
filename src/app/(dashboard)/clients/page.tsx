import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { UserCog } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const items = await db.client.findMany({
    where: { organizationId: membership.organizationId },
    include: { brands: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
      <p className="text-sm text-muted-foreground">Mode agence : gère plusieurs clients, chacun avec ses propres marques.</p>
      {items.length === 0 ? (
        <EmptyState icon={<UserCog className="h-10 w-10" />} title="Aucun client" description="Les clients permettent de regrouper les marques d'une même entreprise." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id}>
              <CardHeader><CardTitle>{c.name}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">{c.brands.length} marque{c.brands.length > 1 ? 's' : ''}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
