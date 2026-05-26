'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ExternalLink, Plug, Unplug, Settings as SettingsIcon, KeyRound, Activity } from 'lucide-react';
import { INTEGRATIONS } from '@/lib/integration-configs';

type Integration = {
  id: string;
  provider: string;
  organization: { id: string; name: string };
  displayName: string | null;
  scope: string | null;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
};

type EnvSummary = { id: string; key: string };

export default function AdminConnectionsPage() {
  const sp = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [envKeys, setEnvKeys] = useState<Set<string>>(new Set());

  async function load() {
    const [c, e] = await Promise.all([
      fetch('/api/admin/connections').then((r) => r.ok ? r.json() : null),
      fetch('/api/admin/env').then((r) => r.ok ? r.json() : null),
    ]);
    if (c?.data?.integrations) setIntegrations(c.data.integrations);
    if (e?.data?.envs) setEnvKeys(new Set(e.data.envs.map((v: EnvSummary) => v.key)));
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const success = sp.get('canva_success');
    const err = sp.get('canva_error');
    if (success) toast.success('Canva connecté avec succès');
    else if (err) toast.error(`Canva: ${err === 'invalid_request' ? 'env vars Canva pas configurées ou redirect URI mismatch — utilise le wizard de setup' : err}`);
  }, [sp]);

  async function disconnect(provider: string) {
    if (provider !== 'canva') return;
    if (!confirm('Déconnecter cette intégration ?')) return;
    const res = await fetch('/api/canva/disconnect', { method: 'POST' });
    if (!res.ok) return toast.error('Erreur');
    toast.success('Déconnecté');
    load();
  }

  const grouped = useMemo(() => {
    const byCat: Record<string, typeof INTEGRATIONS> = {};
    for (const i of INTEGRATIONS) (byCat[i.category] ||= []).push(i);
    return byCat;
  }, []);

  function statusFor(integrationId: string) {
    const cfg = INTEGRATIONS.find((i) => i.id === integrationId);
    if (!cfg) return { state: 'unknown' as const };
    const required = cfg.envVars.filter((v) => v.required).map((v) => v.key);
    const allSet = required.length > 0 && required.every((k) => envKeys.has(k));
    const partial = required.some((k) => envKeys.has(k));
    const hasOAuthFlow = !!cfg.oauthStart;

    if (hasOAuthFlow) {
      // OAuth-style: real connection requires user consent on top of env vars
      const oauthRecord = integrations.find(
        (i) => i.provider.toLowerCase() === integrationId.toLowerCase() && i.active,
      );
      if (oauthRecord) return { state: 'connected' as const, record: oauthRecord };
      if (allSet) return { state: 'ready' as const };
      if (partial) return { state: 'partial' as const };
      return { state: 'missing' as const };
    }

    // API-key-only: having all required env vars = connected
    if (allSet) return { state: 'connected' as const };
    if (partial) return { state: 'partial' as const };
    return { state: 'missing' as const };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connexions & Intégrations</h1>
        <p className="text-sm text-muted-foreground">
          Configure les services tiers (Canva, AI, social, billing). Chaque intégration a son wizard dédié pour les env vars + OAuth quand applicable.
        </p>
      </div>

      {/* Quick nav */}
      <div className="grid gap-3 md:grid-cols-3">
        <Link href="/admin/api-keys">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3 p-4">
              <KeyRound className="h-5 w-5 text-brand-600" />
              <div>
                <div className="font-medium text-sm">Toutes les API Keys</div>
                <div className="text-xs text-muted-foreground">Vue tabulaire de toutes les env vars</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/system">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3 p-4">
              <Activity className="h-5 w-5 text-emerald-600" />
              <div>
                <div className="font-medium text-sm">Health checks</div>
                <div className="text-xs text-muted-foreground">État de toutes les dépendances</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3 p-4">
              <SettingsIcon className="h-5 w-5 text-slate-600" />
              <div>
                <div className="font-medium text-sm">Vue d'ensemble admin</div>
                <div className="text-xs text-muted-foreground">Setup wizard + métriques</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Integration cards grouped by category */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">{category}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((cfg) => {
              const st = statusFor(cfg.id);
              const hasOAuth = !!cfg.oauthStart;
              const status =
                st.state === 'connected' ? { label: hasOAuth ? 'Connecté (OAuth)' : 'Connecté', variant: 'success' as const } :
                st.state === 'ready' ? { label: 'Prêt à OAuth', variant: 'info' as const } :
                st.state === 'partial' ? { label: 'Config partielle', variant: 'warning' as const } :
                { label: 'Non configuré', variant: 'secondary' as const };

              return (
                <Card key={cfg.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-2">
                        <span className="text-xl">{cfg.icon}</span> {cfg.label}
                      </span>
                      <Badge variant={status.variant}>
                        {st.state === 'connected' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                        {status.label}
                      </Badge>
                    </CardTitle>
                    <CardDescription>{cfg.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {st.state === 'connected' && st.record ? (
                      <div className="rounded border p-2 text-xs">
                        <div className="font-medium">{st.record.organization.name}</div>
                        <div className="text-muted-foreground">
                          {st.record.displayName ?? '—'}
                          {st.record.expiresAt ? ` · expire ${new Date(st.record.expiresAt).toLocaleString('fr-FR')}` : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {/* PRIMARY ACTION based on type + state */}
                      {st.state === 'connected' && hasOAuth && cfg.id === 'canva' ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => disconnect(cfg.id)}>
                            <Unplug className="mr-1 h-3 w-3" /> Déconnecter
                          </Button>
                          <Link href={`/admin/setup/${cfg.id}`}>
                            <Button variant="ghost" size="sm">Reconfigurer</Button>
                          </Link>
                        </>
                      ) : st.state === 'connected' && !hasOAuth ? (
                        <Link href={`/admin/setup/${cfg.id}`}>
                          <Button variant="outline" size="sm">
                            <SettingsIcon className="mr-1 h-3 w-3" /> Gérer les clés
                          </Button>
                        </Link>
                      ) : st.state === 'ready' && cfg.oauthStart ? (
                        <a href={cfg.oauthStart}>
                          <Button variant="brand" size="sm">
                            <Plug className="mr-1 h-3 w-3" /> Connecter OAuth
                          </Button>
                        </a>
                      ) : (
                        <Link href={`/admin/setup/${cfg.id}`}>
                          <Button variant="brand" size="sm">
                            <SettingsIcon className="mr-1 h-3 w-3" /> Configurer
                          </Button>
                        </Link>
                      )}

                      {/* SECONDARY ACTIONS */}
                      <a href={cfg.docs} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="mr-1 h-3 w-3" /> Docs
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
