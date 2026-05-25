import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function AdminOrgsPage() {
  const orgs = await db.organization.findMany({
    include: {
      _count: { select: { members: true, brands: true, posts: true, socialAccounts: true } },
      subscription: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Toutes les organisations</h1>

      <Card>
        <CardHeader><CardTitle>{orgs.length} organisations</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Nom</th>
                <th className="px-4 py-2 text-left">Slug</th>
                <th className="px-4 py-2 text-left">Plan</th>
                <th className="px-4 py-2 text-right">Membres</th>
                <th className="px-4 py-2 text-right">Marques</th>
                <th className="px-4 py-2 text-right">Posts</th>
                <th className="px-4 py-2 text-right">Comptes</th>
                <th className="px-4 py-2 text-left">Créée</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{o.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{o.slug}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{o.plan}</Badge></td>
                  <td className="px-4 py-2 text-right">{o._count.members}</td>
                  <td className="px-4 py-2 text-right">{o._count.brands}</td>
                  <td className="px-4 py-2 text-right">{o._count.posts}</td>
                  <td className="px-4 py-2 text-right">{o._count.socialAccounts}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{o.createdAt.toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
