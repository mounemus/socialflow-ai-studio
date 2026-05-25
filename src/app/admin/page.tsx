import Link from 'next/link';
import { db } from '@/lib/db';
import { HealthService } from '@/services/admin/HealthService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, FileText, Bot, AlertTriangle, Activity, CheckCircle2, XCircle, Circle, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const [orgs, users, posts, agentRuns, errors24, recentErrors, recentRuns, probes] = await Promise.all([
    db.organization.count(),
    db.user.count(),
    db.post.count(),
    db.agentRun.count(),
    db.errorLog.count({ where: { createdAt: { gt: new Date(Date.now() - 86_400_000) } } }),
    db.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { organization: true } }),
    db.agentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { organization: true, user: true } }),
    HealthService.runAll(),
  ]);

  const tiles = [
    { icon: Building2, label: 'Organisations', value: orgs, color: 'text-sky-600' },
    { icon: Users, label: 'Utilisateurs', value: users, color: 'text-emerald-600' },
    { icon: FileText, label: 'Publications', value: posts, color: 'text-violet-600' },
    { icon: Bot, label: 'Agent runs', value: agentRuns, color: 'text-fuchsia-600' },
    { icon: AlertTriangle, label: 'Erreurs 24h', value: errors24, color: 'text-rose-600' },
  ];

  const allOk = probes.every((p) => p.status === 'ok' || (p.status === 'not_configured' && !p.required));
  const needSetup = probes.some((p) => p.status === 'not_configured' && !p.required);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Vue d'ensemble Super-Admin</h1>
        <p className="text-sm text-muted-foreground">Statut système, métriques globales, et raccourcis vers la gestion.</p>
      </div>

      {/* ===== SETUP WIZARD ===== */}
      {needSetup ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-5 w-5" /> Configuration incomplète
            </CardTitle>
            <CardDescription className="text-amber-800">
              Certaines intégrations ne sont pas encore configurées. La plateforme fonctionne en mode mock pour ces services.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="space-y-3">
              {probes.filter((p) => p.status === 'not_configured').map((p, idx) => (
                <li key={p.key} className="flex items-start gap-3">
                  <Badge variant="secondary">{idx + 1}</Badge>
                  <div className="flex-1">
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.message}</div>
                    {p.hint ? <div className="text-xs text-amber-700 mt-0.5">💡 {p.hint}</div> : null}
                  </div>
                  {p.key === 'vercel' ? (
                    <a className="text-xs text-brand-600 hover:underline" href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">
                      Créer token →
                    </a>
                  ) : (
                    <Link className="text-xs text-brand-600 hover:underline" href="/admin/api-keys">
                      Configurer →
                    </Link>
                  )}
                </li>
              ))}
            </ol>
            <div className="border-t border-amber-200 pt-3 mt-3 text-xs text-amber-900">
              <strong>Note importante</strong> : <code>VERCEL_API_TOKEN</code> doit être posé manuellement
              une première fois (chicken-and-egg). Une fois posé, toutes les autres clés se configurent depuis{' '}
              <Link className="underline" href="/admin/api-keys">/admin/api-keys</Link>.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ===== HEALTH BAR ===== */}
      <Card className={allOk ? 'border-emerald-300 bg-emerald-50' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Statut système
            </span>
            <Badge variant={allOk ? 'success' : 'warning'}>{allOk ? 'Tout est OK' : 'Attention requise'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {probes.map((p) => {
              const Icon = p.status === 'ok' ? CheckCircle2 : p.status === 'not_configured' ? Circle : XCircle;
              const color = p.status === 'ok' ? 'text-emerald-600' : p.status === 'not_configured' ? 'text-slate-400' : 'text-rose-600';
              return (
                <div key={p.key} className="flex items-center gap-2 rounded border bg-white p-2 text-sm">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <div className="flex-1">
                    <div className="font-medium">{p.label}</div>
                    {p.latencyMs ? <div className="text-[10px] text-muted-foreground">{p.latencyMs}ms</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ===== METRIC TILES ===== */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{t.label}</CardTitle>
                <Icon className={`h-4 w-4 ${t.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{t.value.toLocaleString('fr-FR')}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ===== QUICK ACTIONS ===== */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { href: '/admin/api-keys', label: 'Configurer les clés API', icon: '🔑' },
          { href: '/admin/users', label: 'Gérer les utilisateurs', icon: '👥' },
          { href: '/admin/orgs', label: 'Gérer les organisations', icon: '🏢' },
          { href: '/admin/agent', label: 'Agents IA & automatisations', icon: '🤖' },
        ].map((a) => (
          <Link key={a.href} href={a.href}>
            <Card className="transition-shadow hover:shadow-md cursor-pointer">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">{a.icon}</div>
                  <span className="text-sm font-medium">{a.label}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* ===== RECENT ACTIVITY ===== */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Erreurs récentes</CardTitle></CardHeader>
          <CardContent>
            {recentErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune erreur récente 🎉</p>
            ) : (
              <ul className="divide-y text-sm">
                {recentErrors.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="font-medium text-rose-700">{e.context}</div>
                    <div className="text-xs text-muted-foreground">{e.organization?.name ?? 'global'} · {e.createdAt.toLocaleString('fr-FR')}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Derniers agent runs</CardTitle></CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pas encore de runs.</p>
            ) : (
              <ul className="divide-y text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="font-medium">{r.title ?? r.kind}</div>
                    <div className="text-xs text-muted-foreground">{r.organization.name} · {r.kind} · {r.status}</div>
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
