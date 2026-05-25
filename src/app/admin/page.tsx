import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Building2, Users, FileText, Bot, AlertTriangle, Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const [orgs, users, posts, agentRuns, errors, recentErrors, recentRuns] = await Promise.all([
    db.organization.count(),
    db.user.count(),
    db.post.count(),
    db.agentRun.count(),
    db.errorLog.count({ where: { createdAt: { gt: new Date(Date.now() - 86_400_000) } } }),
    db.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { organization: true } }),
    db.agentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { organization: true, user: true } }),
  ]);

  const tiles = [
    { icon: Building2, label: 'Organisations', value: orgs, color: 'text-sky-600' },
    { icon: Users, label: 'Utilisateurs', value: users, color: 'text-emerald-600' },
    { icon: FileText, label: 'Publications', value: posts, color: 'text-violet-600' },
    { icon: Bot, label: 'Agent runs', value: agentRuns, color: 'text-fuchsia-600' },
    { icon: AlertTriangle, label: 'Erreurs 24h', value: errors, color: 'text-rose-600' },
    { icon: Activity, label: 'Statut', value: 'OK', color: 'text-emerald-600' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Vue d'ensemble Super-Admin</h1>
        <p className="text-sm text-muted-foreground">Métriques globales sur toute la plateforme.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{t.label}</CardTitle>
                <Icon className={`h-4 w-4 ${t.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{typeof t.value === 'number' ? t.value.toLocaleString('fr-FR') : t.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Erreurs récentes</CardTitle>
            <CardDescription>5 dernières entrées ErrorLog</CardDescription>
          </CardHeader>
          <CardContent>
            {recentErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune erreur récente 🎉</p>
            ) : (
              <ul className="divide-y text-sm">
                {recentErrors.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="font-medium text-rose-700">{e.context}</div>
                    <div className="text-xs text-muted-foreground">{e.organization?.name ?? 'global'} · {e.createdAt.toLocaleString('fr-FR')}</div>
                    <div className="text-xs text-slate-600 line-clamp-2">{e.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Derniers runs agent</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pas encore de runs.</p>
            ) : (
              <ul className="divide-y text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="font-medium">{r.title ?? r.kind}</div>
                    <div className="text-xs text-muted-foreground">{r.organization.name} · {r.user?.email ?? 'system'} · {r.status}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
