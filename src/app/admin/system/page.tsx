'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Circle, RefreshCw } from 'lucide-react';

type Probe = {
  key: string; label: string;
  status: 'ok' | 'degraded' | 'down' | 'not_configured';
  latencyMs?: number; message?: string; hint?: string; required: boolean;
};

type AuditEntry = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  createdAt: string;
  user: { email: string; name: string | null } | null;
  metadata: unknown;
};

export default function AdminSystemPage() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [overall, setOverall] = useState<'ok' | 'attention'>('ok');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const [healthRes, auditRes] = await Promise.all([
      fetch('/api/admin/health'),
      fetch('/api/admin/audit'),
    ]);
    if (healthRes.ok) {
      const { data } = await healthRes.json();
      setProbes(data.probes);
      setOverall(data.overall);
    }
    if (auditRes.ok) setAudit((await auditRes.json()).data);
    setLoading(false);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  function statusBadge(p: Probe) {
    const map = {
      ok: { variant: 'success' as const, label: 'OK' },
      degraded: { variant: 'warning' as const, label: 'Dégradé' },
      down: { variant: 'destructive' as const, label: 'KO' },
      not_configured: { variant: 'secondary' as const, label: 'Non configuré' },
    };
    return <Badge variant={map[p.status].variant}>{map[p.status].label}</Badge>;
  }

  function StatusIcon({ status }: { status: Probe['status'] }) {
    if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    if (status === 'not_configured') return <Circle className="h-4 w-4 text-slate-400" />;
    if (status === 'degraded') return <Circle className="h-4 w-4 text-amber-500 fill-amber-500" />;
    return <XCircle className="h-4 w-4 text-rose-600" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Système</h1>
          <p className="text-sm text-muted-foreground">Health checks, audit log, et utilitaires plateforme.</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? '...' : 'Rafraîchir'}
        </Button>
      </div>

      <Card className={overall === 'ok' ? 'border-emerald-300' : 'border-amber-300'}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Statut global</span>
            <Badge variant={overall === 'ok' ? 'success' : 'warning'}>{overall === 'ok' ? 'Tout est opérationnel' : 'Attention requise'}</Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dépendances externes</CardTitle>
          <CardDescription>Chaque probe avec sa latence et un hint en cas d'échec.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {probes.map((p) => (
              <li key={p.key} className="flex items-start gap-3 py-3">
                <StatusIcon status={p.status} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.label}</span>
                    {p.required ? <Badge variant="outline">requis</Badge> : null}
                  </div>
                  {p.message ? <div className="text-xs text-muted-foreground">{p.message}</div> : null}
                  {p.hint ? <div className="text-xs text-amber-700 mt-0.5">💡 {p.hint}</div> : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {statusBadge(p)}
                  {p.latencyMs ? <span className="text-[10px] text-muted-foreground">{p.latencyMs}ms</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal d'audit ({audit.length} dernières actions)</CardTitle>
          <CardDescription>Toutes les actions sensibles (env vars, users, orgs, deployments) sont tracées.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {audit.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Aucune entrée.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Quand</th>
                  <th className="px-4 py-2 text-left">Qui</th>
                  <th className="px-4 py-2 text-left">Action</th>
                  <th className="px-4 py-2 text-left">Ressource</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-2 text-xs">{a.user?.email ?? 'system'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.action}</td>
                    <td className="px-4 py-2 text-xs">{a.resource} {a.resourceId ? `· ${a.resourceId.slice(0, 16)}…` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
