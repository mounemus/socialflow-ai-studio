'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, CheckCircle2, AlertTriangle, Rocket, Plug } from 'lucide-react';
import { INTEGRATIONS, type IntegrationConfig } from '@/lib/integration-configs';

type EnvVar = { id: string; key: string };

export default function IntegrationSetupPage() {
  const params = useParams<{ provider: string }>();
  const router = useRouter();
  const config = useMemo<IntegrationConfig | undefined>(() => INTEGRATIONS.find((i) => i.id === params.provider), [params.provider]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; reason?: string; envPresent?: Record<string, boolean> } | null>(null);

  useEffect(() => {
    if (!config) return;
    // Init defaults
    const init: Record<string, string> = {};
    for (const v of config.envVars) {
      if (v.defaultValue) init[v.key] = v.defaultValue;
    }
    setValues(init);

    // Load existing env vars from Vercel
    fetch('/api/admin/env').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d?.data?.envs) return;
      const present = new Set<string>(d.data.envs.map((e: EnvVar) => e.key));
      setExisting(present);
    });
  }, [config]);

  if (!config) {
    return (
      <div className="max-w-2xl">
        <Link href="/admin/connections" className="text-xs text-slate-500 hover:underline">
          <ArrowLeft className="h-3 w-3 inline" /> Connexions OAuth
        </Link>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Intégration inconnue</CardTitle>
            <CardDescription>Aucune intégration "{params.provider}" trouvée.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  async function saveAll() {
    if (!config) return;
    const missing = config.envVars.filter((v) => v.required && !values[v.key]);
    if (missing.length > 0) {
      return toast.error(`Champs requis manquants : ${missing.map((m) => m.label).join(', ')}`);
    }
    setBusy('save');
    const vars = config.envVars
      .filter((v) => values[v.key] !== undefined && values[v.key] !== '')
      .map((v) => ({
        key: v.key,
        value: values[v.key],
        type: (v.type === 'password' ? 'sensitive' : 'encrypted') as 'sensitive' | 'encrypted',
      }));
    const res = await fetch('/api/admin/env/batch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vars, redeploy: true }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur');
    }
    const { data } = await res.json();
    if (!data.allOk) {
      const failed = data.results.filter((r: { ok: boolean }) => !r.ok);
      toast.error(`Erreur sur : ${failed.map((f: { key: string }) => f.key).join(', ')}`);
      return;
    }
    if (data.deployment?.url) {
      toast.success(`Configuré ! Redéploiement en cours : ${data.deployment.url}`);
    } else {
      toast.success('Configuré ! (Redéploie manuellement si la connection ne marche pas)');
    }
    // Refresh existing list
    fetch('/api/admin/env').then((r) => r.json()).then((d) => {
      if (d.data?.envs) setExisting(new Set(d.data.envs.map((e: EnvVar) => e.key)));
    });
  }

  async function testConnection() {
    if (!config) return;
    setBusy('test');
    setTestResult(null);
    const res = await fetch(`/api/admin/test-integration/${config.id}`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) return toast.error('Test échoué');
    const { data } = await res.json();
    setTestResult(data);
    if (data.ok) toast.success('Connexion OK');
    else toast.warning(data.reason ?? 'Test échoué');
  }

  const allRequiredSet = config.envVars.filter((v) => v.required).every((v) => existing.has(v.key));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/admin/connections" className="hover:underline"><ArrowLeft className="h-3 w-3 inline" /> Connexions</Link>
          <span>/</span>
          <span>Setup {config.label}</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight flex items-center gap-3">
          <span className="text-3xl">{config.icon}</span>
          {config.label}
          {allRequiredSet ? <Badge variant="success">configuré</Badge> : <Badge variant="warning">à configurer</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{config.description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Où récupérer les clés</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <a href={config.getKeysAt} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1">
            {config.getKeysAt} <ExternalLink className="h-3 w-3" />
          </a>
          <br />
          <a href={config.docs} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
            Documentation officielle →
          </a>
          {config.notes ? (
            <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="h-3 w-3 inline mr-1" /> {config.notes}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variables d'environnement</CardTitle>
          <CardDescription>Posées en production via l'API Vercel. Les secrets sont chiffrés.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.envVars.map((v) => {
            const isSet = existing.has(v.key);
            return (
              <div key={v.key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>
                    {v.label}
                    {v.required ? <span className="text-rose-600"> *</span> : null}
                  </Label>
                  <div className="flex items-center gap-2">
                    {isSet ? <Badge variant="success" className="text-[10px]">déjà défini</Badge> : null}
                    <code className="text-[10px] text-muted-foreground">{v.key}</code>
                  </div>
                </div>
                {v.type === 'boolean' ? (
                  <select className="h-10 w-full rounded-md border px-3 text-sm" value={values[v.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}>
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <Input
                    type={v.type === 'password' ? 'password' : v.type === 'url' ? 'url' : 'text'}
                    value={values[v.key] ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                    placeholder={isSet ? '••••••• (déjà défini — laisse vide pour conserver, ou remplis pour mettre à jour)' : v.hint ?? ''}
                  />
                )}
                {v.hint ? <p className="text-[11px] text-muted-foreground">{v.hint}</p> : null}
              </div>
            );
          })}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="brand" onClick={saveAll} disabled={busy === 'save'}>
            <Rocket className="mr-2 h-4 w-4" />
            {busy === 'save' ? 'Enregistrement + redeploy…' : 'Enregistrer + redéployer'}
          </Button>
          <Button variant="outline" onClick={testConnection} disabled={busy === 'test'}>
            {busy === 'test' ? 'Test…' : 'Tester la connexion'}
          </Button>
          {config.oauthStart && allRequiredSet ? (
            <a href={config.oauthStart}>
              <Button variant="secondary">
                <Plug className="mr-2 h-4 w-4" /> Lancer le flow OAuth
              </Button>
            </a>
          ) : null}
        </CardFooter>
      </Card>

      {testResult ? (
        <Card className={testResult.ok ? 'border-emerald-300' : 'border-rose-300'}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {testResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
              Résultat du test
            </CardTitle>
          </CardHeader>
          <CardContent>
            {testResult.ok ? (
              <p className="text-sm text-emerald-700">Connexion établie avec succès.</p>
            ) : (
              <>
                <p className="text-sm text-rose-700">{testResult.reason ?? 'Échec'}</p>
                {testResult.envPresent ? (
                  <pre className="mt-2 rounded bg-slate-50 p-2 text-xs">{JSON.stringify(testResult.envPresent, null, 2)}</pre>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">Aide rapide</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Link href="/admin/api-keys" className="text-brand-600 hover:underline block">→ Voir toutes les API keys</Link>
          <Link href="/admin/connections" className="text-brand-600 hover:underline block">→ Voir toutes les connexions OAuth</Link>
          <Link href="/admin/system" className="text-brand-600 hover:underline block">→ Vérifier l'état système complet</Link>
        </CardContent>
      </Card>
    </div>
  );
}
