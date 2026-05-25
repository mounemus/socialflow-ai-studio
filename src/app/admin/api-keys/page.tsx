'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Save, Trash2, Rocket } from 'lucide-react';

const KNOWN: { key: string; label: string; group: string; doc?: string }[] = [
  { key: 'OPENAI_API_KEY', label: 'OpenAI', group: 'AI', doc: 'https://platform.openai.com/api-keys' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', group: 'AI', doc: 'https://console.anthropic.com/' },
  { key: 'GOOGLE_GEMINI_API_KEY', label: 'Google Gemini', group: 'AI', doc: 'https://aistudio.google.com/apikey' },
  { key: 'REPLICATE_API_TOKEN', label: 'Replicate', group: 'AI' },
  { key: 'STABILITY_API_KEY', label: 'Stability AI', group: 'AI' },
  { key: 'ENABLE_REAL_AI', label: 'Activer IA réelle (true/false)', group: 'AI flags' },
  { key: 'AI_DEFAULT_TEXT_PROVIDER', label: 'Provider texte (openai|anthropic|gemini|mock)', group: 'AI flags' },
  { key: 'CANVA_CLIENT_ID', label: 'Canva Client ID', group: 'Canva' },
  { key: 'CANVA_CLIENT_SECRET', label: 'Canva Secret', group: 'Canva' },
  { key: 'CANVA_REDIRECT_URI', label: 'Canva Redirect URI (ex: https://.../api/canva/callback)', group: 'Canva' },
  { key: 'ENABLE_CANVA_API', label: 'Activer Canva API (true/false)', group: 'Canva' },
  { key: 'NEXT_PUBLIC_APP_URL', label: 'URL de l\'app (utilisée par OAuth callbacks)', group: 'Infra' },
  { key: 'FACEBOOK_APP_ID', label: 'Facebook App ID', group: 'Social' },
  { key: 'FACEBOOK_APP_SECRET', label: 'Facebook Secret', group: 'Social' },
  { key: 'INSTAGRAM_APP_ID', label: 'Instagram App ID', group: 'Social' },
  { key: 'INSTAGRAM_APP_SECRET', label: 'Instagram Secret', group: 'Social' },
  { key: 'LINKEDIN_CLIENT_ID', label: 'LinkedIn Client ID', group: 'Social' },
  { key: 'LINKEDIN_CLIENT_SECRET', label: 'LinkedIn Secret', group: 'Social' },
  { key: 'TWITTER_CLIENT_ID', label: 'X Client ID', group: 'Social' },
  { key: 'TWITTER_CLIENT_SECRET', label: 'X Secret', group: 'Social' },
  { key: 'TIKTOK_CLIENT_KEY', label: 'TikTok Client', group: 'Social' },
  { key: 'TIKTOK_CLIENT_SECRET', label: 'TikTok Secret', group: 'Social' },
  { key: 'YOUTUBE_CLIENT_ID', label: 'YouTube Client ID', group: 'Social' },
  { key: 'YOUTUBE_CLIENT_SECRET', label: 'YouTube Secret', group: 'Social' },
  { key: 'PINTEREST_APP_ID', label: 'Pinterest App ID', group: 'Social' },
  { key: 'PINTEREST_APP_SECRET', label: 'Pinterest Secret', group: 'Social' },
  { key: 'ENABLE_REAL_PUBLISHING', label: 'Publication réelle (true/false)', group: 'Social flags' },
  { key: 'REDIS_URL', label: 'Redis URL', group: 'Infra' },
  { key: 'STRIPE_SECRET_KEY', label: 'Stripe secret', group: 'Billing' },
  { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook secret', group: 'Billing' },
];

type EnvVar = { id: string; key: string; type: string; target: string[]; updatedAt?: number };

export default function AdminApiKeysPage() {
  const [configured, setConfigured] = useState(false);
  const [envs, setEnvs] = useState<EnvVar[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/env');
    if (!res.ok) return;
    const { data } = await res.json();
    setConfigured(data.configured);
    setEnvs(data.envs);
  }
  useEffect(() => { load(); }, []);

  const envByKey = new Map(envs.map((e) => [e.key, e]));

  async function save(key: string) {
    if (!edits[key]) return toast.error('Valeur vide');
    setBusy(key);
    const res = await fetch('/api/admin/env', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value: edits[key], target: ['production'], type: 'encrypted' }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur');
    }
    toast.success(`${key} enregistré`);
    setEdits((e) => { const c = { ...e }; delete c[key]; return c; });
    load();
  }

  async function remove(envId: string, key: string) {
    if (!confirm(`Supprimer ${key} ?`)) return;
    setBusy(envId);
    const res = await fetch(`/api/admin/env/${envId}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Supprimé');
    load();
  }

  async function redeploy() {
    if (!confirm('Lancer un nouveau déploiement production maintenant ?')) return;
    setBusy('redeploy');
    const res = await fetch('/api/admin/env/redeploy', { method: 'POST' });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); return toast.error(j.message ?? 'Erreur'); }
    const { data } = await res.json();
    toast.success(`Déploiement lancé : ${data.url}`);
  }

  const grouped = KNOWN.reduce<Record<string, typeof KNOWN>>((acc, k) => {
    (acc[k.group] ||= []).push(k);
    return acc;
  }, {});

  if (!configured) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">API Keys (Vercel)</h1>
        <Card>
          <CardHeader>
            <CardTitle>Service Vercel non configuré</CardTitle>
            <CardDescription>Cette page nécessite VERCEL_API_TOKEN et VERCEL_PROJECT_ID dans les env vars du projet Vercel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Va sur <a className="text-brand-600 hover:underline" href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">vercel.com/account/tokens</a> → crée un token (scope: project ou full account)</li>
              <li>Ajoute-le comme env var dans ce projet Vercel: <code>VERCEL_API_TOKEN</code></li>
              <li>Récupère ton Project ID dans Settings → General → "Project ID"</li>
              <li>Ajoute-le comme env var: <code>VERCEL_PROJECT_ID</code></li>
              <li>Si tu es dans une team (mounemus-projects), ajoute aussi <code>VERCEL_TEAM_ID</code> (team_xxx dans le settings team)</li>
              <li>Redeploy via <code>vercel deploy --prod</code> et reviens ici</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys & feature flags</h1>
          <p className="text-sm text-muted-foreground">Gérer les env vars de production directement via l'API Vercel.</p>
        </div>
        <Button variant="brand" onClick={redeploy} disabled={busy === 'redeploy'}>
          <Rocket className="mr-2 h-4 w-4" /> {busy === 'redeploy' ? '...' : 'Redéployer prod'}
        </Button>
      </div>

      {Object.entries(grouped).map(([group, items]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((it) => {
              const existing = envByKey.get(it.key);
              const isSet = !!existing;
              return (
                <div key={it.key} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="w-64">
                    <div className="text-sm font-medium">{it.label}</div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-muted-foreground">{it.key}</code>
                      {it.doc ? (
                        <a href={it.doc} target="_blank" rel="noopener noreferrer" className="text-brand-600">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex-1">
                    <Input
                      placeholder={isSet ? '••••••••••••  (déjà défini — vide pour conserver)' : 'Non défini'}
                      value={edits[it.key] ?? ''}
                      onChange={(e) => setEdits((s) => ({ ...s, [it.key]: e.target.value }))}
                      type={it.key.includes('SECRET') || it.key.includes('KEY') || it.key.includes('TOKEN') ? 'password' : 'text'}
                    />
                  </div>
                  <Badge variant={isSet ? 'success' : 'secondary'}>{isSet ? 'défini' : 'absent'}</Badge>
                  <Button variant="brand" size="sm" disabled={!edits[it.key] || busy === it.key} onClick={() => save(it.key)}>
                    <Save className="mr-1 h-3 w-3" /> {busy === it.key ? '...' : 'OK'}
                  </Button>
                  {isSet ? (
                    <Button variant="ghost" size="icon" onClick={() => existing && remove(existing.id, it.key)} disabled={busy === existing?.id}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Autres env vars détectées</CardTitle>
          <CardDescription>Variables présentes dans Vercel mais pas dans la liste curated.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {envs.filter((e) => !KNOWN.find((k) => k.key === e.key)).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <code className="text-xs">{e.key}</code>
                <span className="text-xs text-muted-foreground">{e.target.join(', ')}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
