import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserActions } from './UserActions';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const users = await db.user.findMany({
    include: {
      memberships: { include: { organization: true } },
      _count: { select: { createdPosts: true, aiRequests: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Tous les utilisateurs</h1>

      <Card>
        <CardHeader><CardTitle>{users.length} utilisateurs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Nom</th>
                <th className="px-4 py-2 text-left">Rôle global</th>
                <th className="px-4 py-2 text-left">Organisations</th>
                <th className="px-4 py-2 text-right">Posts</th>
                <th className="px-4 py-2 text-left">Statut</th>
                <th className="px-4 py-2 text-left">Créé</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{u.email}</td>
                  <td className="px-4 py-2">{u.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge variant={u.globalRole === 'SUPER_ADMIN' ? 'destructive' : 'secondary'}>{u.globalRole}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {u.memberships.map((m) => m.organization.name).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{u._count.createdPosts}</td>
                  <td className="px-4 py-2">
                    <Badge variant={u.disabled ? 'destructive' : 'success'}>{u.disabled ? 'Désactivé' : 'Actif'}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{u.createdAt.toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-2 text-right">
                    <UserActions userId={u.id} disabled={u.disabled} globalRole={u.globalRole} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
