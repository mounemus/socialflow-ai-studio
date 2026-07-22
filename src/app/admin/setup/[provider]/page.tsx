'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, CheckCircle2, AlertTriangle, Rocket, Plug, Loader2, RefreshCw } from 'lucide-react';
import { INTEGRATIONS, type IntegrationConfig } from '@/lib/integration-configs';
import { apiBaseProblem } from '@/lib/env-guard';

type EnvVar = { id: string; key: string };
type TestResult = {
  ok: boolean;
  reason?: string;
  status?: number;
  latencyMs?: number;
  envPresent?: Record<string, boolean>;
};

export default function IntegrationSetupPage() {
  const params = useParams<{ provider: string }>();
  const config = useMemo<IntegrationConfig | undefined>(
    () => INTEGRATIONS.find((i) => i.id === params.provider),
    [params.provider],
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [deployState, setDeployState] = useState<{ id?: string; state?: string; ageSeconds?: number; url?: string } | null>(null);
  const [polling, setPolling] = useState(false);

  const loadExistingEnv = useCallback(() => {
    fetch('/api/admin/env')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.data?.envs) return;
        setExisting(new Set<string>(d.data.envs.map((e: EnvVar) => e.key)));
      });
  }, []);

  useEffect(() => {
    if (!config) return;
    const init: Record<string, string> = {};
    for (const v of config.envVars) {
      if (v.defaultValue) init[v.key] = v.defaultValue;
    }
    setValues(init);
    loadExistingEnv();
  }, [config, loadExistingEnv]);

  if (!config) {
    return (
      <div className="max-w-2xl">
        <Link href="/admin/connections" className="text-xs text-slate-500 hover:underline">
          <ArrowLeft className="h-3 w-3 inline" /> Connexions
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

  // Map env vars to current state
  const envInVercel = config.envVars.filter((v) => existing.has(v.key));
  const requiredKeys = config.envVars.filter((v) => v.required).map((v) => v.key);
  const allRequiredInVercel = requiredKeys.every((k) => existing.has(k));
  const allRequiredInRuntime = testResult?.envPresent
    ? requiredKeys.every((k) => testResult.envPresent![k])
    : null;

  // Step status
  const stepFill: 'pending' | 'doing' | 'done' = envInVercel.length === 0
    ? (Object.values(values).some((v) => v.trim()) ? 'doing' : 'pending')
    : 'done';
  const stepSave: 'pending' | 'doing' | 'done' = allRequiredInVercel ? 'done' : 'pending';
  const stepDeploy: 'pending' | 'doing' | 'done' = polling
    ? 'doing'
    : (deployState?.state === 'READY' && (deployState.ageSeconds ?? 999) < 300 ? 'done' : (allRequiredInVercel ? 'done' : 'pending'));
  const stepTest: 'pending' | 'doing' | 'done' = testResult?.ok ? 'done' : (testResult ? 'pending' : 'pending');

  async function pollDeploy() {
    setPolling(true);
    let attempts = 0;
    const maxAttempts = 30; // ~90s
    while (attempts < maxAttempts) {
      attempts++;
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch('/api/admin/deployment-status');
      if (!res.ok) break;
      const { data } = await res.json();
      if (!data.configured) break;
      setDeployState(data.deployment);
      if (data.deployment?.state === 'READY' && (data.deployment.ageSeconds ?? 999) < 180) {
        setPolling(false);
        return true;
      }
    }
    setPolling(false);
    return false;
  }

  async function saveAll(autoTest = true) {
    if (!config) return;
    const missing = config.envVars.filter((v) => v.required && !values[v.key] && !existing.has(v.key));
    if (missing.length > 0) {
      return toast.error(`Champs requis manquants : ${missing.map((m) => m.label).join(', ')}`);
    }
    // Garde-fou immédiat (le serveur revalide) : base d'API ≠ page sociale,
    // ≠ URL de webhook, ≠ SocialFlow lui-même.
    for (const v of config.envVars) {
      const val = values[v.key];
      if (!val) continue;
      const problem = apiBaseProblem(v.key, val);
      if (problem) return toast.error(problem);
    }
    setBusy('save');
    setTestResult(null);
    const vars = config.envVars
      .filter((v) => values[v.key] !== undefined && values[v.key] !== '')
      .map((v) => ({
        key: v.key,
        value: values[v.key],
        type: (v.type === 'password' ? 'sensitive' : 'encrypted') as 'sensitive' | 'encrypted',
      }));

    if (vars.length === 0) {
      setBusy(null);
      return toast.info('Aucune nouvelle valeur à enregistrer');
    }

    const res = await fetch('/api/admin/env/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vars, redeploy: true }),
    });
    if (!res.ok) {
      setBusy(null);
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur');
    }
    const { data } = await res.json();
    if (!data.allOk) {
      const failed = data.results.filter((r: { ok: boolean }) => !r.ok);
      setBusy(null);
      return toast.error(`Erreur sur : ${failed.map((f: { key: string }) => f.key).join(', ')}`);
    }
    toast.success('Variables enregistrées. Redéploiement en cours…');
    loadExistingEnv();

    if (autoTest) {
      // Poll until deploy ready, then test
      const ready = await pollDeploy();
      setBusy(null);
      if (ready) {
        toast.success('Déploiement terminé — test en cours…');
        await testConnection();
      } else {
        toast.warning('Déploiement long — clique "Tester la connexion" manuellement dans 30s');
      }
    } else {
      setBusy(null);
    }
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
    else toast.warning('Test révèle un problème — voir détails');
  }

  function Step({ n, title, status, hint }: { n: number; title: string; status: 'pending' | 'doing' | 'done'; hint?: string }) {
    const dot =
      status === 'done' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> :
      status === 'doing' ? <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> :
      <div className="h-5 w-5 rounded-full border-2 border-slate-300 text-[10px] flex items-center justify-center text-slate-500">{n}</div>;
    return (
      <div className="flex items-start gap-3">
        {dot}
        <div className="flex-1">
          <div className={`text-sm font-medium ${status === 'done' ? 'text-emerald-700' : status === 'doing' ? 'text-brand-700' : 'text-slate-700'}`}>
            {title}
          </div>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
      </div>
    );
  }

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
          {allRequiredInVercel ? (
            allRequiredInRuntime ?
              <Badge variant="success">opérationnel</Badge> :
              <Badge variant="warning">en attente de redeploy</Badge>
          ) : (
            <Badge variant="secondary">à configurer</Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{config.description}</p>
      </div>

      {/* ===== WORKFLOW STEPS ===== */}
      <Card className="border-brand-200 bg-brand-50/30">
        <CardHeader>
          <CardTitle className="text-base">Workflow d'activation</CardTitle>
          <CardDescription>4 étapes — auto-test après le redeploy si tu cliques sur "Enregistrer".</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Step n={1} title="Saisir les valeurs ci-dessous" status={stepFill} hint="Récupère les clés sur la doc fournisseur" />
          <Step n={2} title="Enregistrer dans Vercel" status={stepSave} hint="Posées comme env vars chiffrées via l'API Vercel" />
          <Step n={3} title="Redéploiement" status={stepDeploy} hint={polling ? `En cours… (~30-60s)${deployState?.ageSeconds ? ` · ${deployState.ageSeconds}s` : ''}` : 'Vercel rebuild + redémarre les lambdas'} />
          <Step n={4} title="Test de connexion" status={stepTest} hint="Probe live vers l'API fournisseur" />
        </CardContent>
      </Card>

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
          {config.webhookUrl ? (
            <div className="mt-3 space-y-1.5 rounded border bg-secondary/50 p-3">
              <div className="text-xs font-semibold">
                URL du webhook — à coller chez le fournisseur (pas dans les variables ci-dessous)
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-card px-2 py-1.5 text-[11px]">
                  {config.webhookUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(config.webhookUrl!);
                    toast.success('URL du webhook copiée');
                  }}
                >
                  Copier
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variables d'environnement</CardTitle>
          <CardDescription>Posées en production via l'API Vercel. Les secrets sont chiffrés au repos.</CardDescription>
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
          <Button variant="brand" onClick={() => saveAll(true)} disabled={busy === 'save' || polling}>
            <Rocket className="mr-2 h-4 w-4" />
            {busy === 'save' ? 'Enregistrement…' : polling ? `Redeploy…${deployState?.ageSeconds ? ` (${deployState.ageSeconds}s)` : ''}` : 'Enregistrer + redéployer + tester'}
          </Button>
          <Button variant="outline" onClick={testConnection} disabled={busy === 'test' || polling}>
            {busy === 'test' ? 'Test…' : 'Tester maintenant'}
          </Button>
          <Button variant="ghost" size="sm" onClick={loadExistingEnv}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          {config.oauthStart && allRequiredInRuntime ? (
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
              {testResult.latencyMs ? <span className="text-[10px] text-muted-foreground">{testResult.latencyMs}ms</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {testResult.ok ? (
              <p className="text-sm text-emerald-700">Connexion établie avec succès.</p>
            ) : (
              <>
                <p className="text-sm text-rose-700">{testResult.reason ?? 'Échec'}</p>

                {/* Smart diagnostic */}
                {testResult.envPresent && Object.values(testResult.envPresent).every((v) => !v) && allRequiredInVercel ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <div className="font-medium mb-1">💡 Diagnostic</div>
                    Tes clés sont bien dans Vercel (✓ "déjà défini") mais le déploiement courant ne les a pas encore chargées.
                    Patiente 30-60s puis re-teste, OU clique "Enregistrer + redéployer + tester" pour forcer un nouveau déploiement.
                  </div>
                ) : null}

                {testResult.envPresent ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">État dans le runtime courant :</div>
                    <ul className="space-y-0.5 text-xs">
                      {Object.entries(testResult.envPresent).map(([k, v]) => (
                        <li key={k} className="flex items-center gap-2">
                          {v ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-rose-600" />}
                          <code className="text-[11px]">{k}</code>
                          <span className="text-muted-foreground">{v ? 'présent' : 'absent'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
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
          <Link href="/admin/connections" className="text-brand-600 hover:underline block">→ Voir toutes les connexions</Link>
          <Link href="/admin/system" className="text-brand-600 hover:underline block">→ Vérifier l'état système complet</Link>
        </CardContent>
      </Card>
    </div>
  );
}
