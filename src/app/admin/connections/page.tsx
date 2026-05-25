'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ExternalLink, Plug, Unplug } from 'lucide-react';

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

const PROVIDERS = [
  { id: 'CANVA', label: 'Canva Connect', docs: 'https://www.canva.dev/docs/connect/', startPath: '/api/canva/connect', envHint: 'CANVA_CLIENT_ID + CANVA_CLIENT_SECRET + ENABLE_CANVA_API=true' },
  { id: 'GOOGLE_DRIVE', label: 'Google Drive', docs: 'https://developers.google.com/drive', startPath: null, envHint: 'à implémenter' },
  { id: 'SLACK', label: 'Slack', docs: 'https://api.slack.com/', startPath: null, envHint: 'à implémenter' },
  { id: 'NOTION', label: 'Notion', docs: 'https://developers.notion.com/', startPath: null, envHint: 'à implémenter' },
  { id: 'FIGMA', label: 'Figma', docs: 'https://www.figma.com/developers/api', startPath: null, envHint: 'à implémenter' },
  { id: 'HUBSPOT', label: 'HubSpot', docs: 'https://developers.hubspot.com/', startPath: null, envHint: 'à implémenter' },
  { id: 'STRIPE', label: 'Stripe (billing)', docs: 'https://stripe.com/docs/api', startPath: null, envHint: 'à implémenter' },
];

export default function AdminConnectionsPage() {
  const sp = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [canvaConfigured, setCanvaConfigured] = useState(false);

  async function load() {
    const res = await fetch('/api/admin/connections');
    if (!res.ok) return;
    const { data } = await res.json();
    setIntegrations(data.integrations);
    setCanvaConfigured(data.canvaConfigured);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const success = sp.get('canva_success');
    const err = sp.get('canva_error');
    if (success) toast.success('Canva connecté avec succès');
    else if (err) toast.error(`Canva: ${err}`);
  }, [sp]);

  async function disconnectCanva(integrationId: string) {
    if (!confirm('Déconnecter Canva ? Les designs déjà liés restent dans la médiathèque.')) return;
    const res = await fetch('/api/canva/disconnect', { method: 'POST' });
    if (!res.ok) return toast.error('Erreur');
    toast.success('Canva déconnecté');
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connexions OAuth</h1>
        <p className="text-sm text-muted-foreground">Connecter les services tiers (Canva, Google Drive, Slack...) via OAuth. Tokens chiffrés AES-256-GCM en DB.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const active = integrations.filter((i) => i.provider === p.id && i.active);
          const canConnect = p.id === 'CANVA' ? canvaConfigured : false;
          return (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{p.label}</span>
                  {active.length > 0 ? (
                    <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />Connecté</Badge>
                  ) : canConnect ? (
                    <Badge variant="secondary">Disponible</Badge>
                  ) : (
                    <Badge variant="outline">Non configuré</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {active.length === 0 && !canConnect ? p.envHint : null}
                  {active.length > 0 ? `${active.length} connexion${active.length > 1 ? 's' : ''}` : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {active.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {active.map((i) => (
                      <li key={i.id} className="flex items-center justify-between rounded border p-2">
                        <div>
                          <div className="font-medium">{i.organization.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {i.displayName ?? '—'}
                            {i.expiresAt ? ` · expire ${new Date(i.expiresAt).toLocaleString('fr-FR')}` : null}
                          </div>
                        </div>
                        {p.id === 'CANVA' ? (
                          <Button variant="ghost" size="sm" onClick={() => disconnectCanva(i.id)}>
                            <Unplug className="mr-1 h-3 w-3" /> Déconnecter
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex gap-2">
                  {p.startPath && canConnect ? (
                    <a href={p.startPath}>
                      <Button variant="brand" size="sm">
                        <Plug className="mr-1 h-3 w-3" /> Connecter
                      </Button>
                    </a>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <Plug className="mr-1 h-3 w-3" /> {canConnect ? 'Bientôt' : 'À configurer dans API Keys'}
                    </Button>
                  )}
                  <a href={p.docs} target="_blank" rel="noopener noreferrer">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Étapes pour activer Canva Connect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Créer une intégration sur <a className="text-brand-600 hover:underline" href="https://www.canva.com/developers/integrations" target="_blank" rel="noopener noreferrer">canva.com/developers/integrations</a></li>
            <li>Type: <strong>Public</strong> ou <strong>Team</strong>. Redirect URI: <code>https://socialflow-ai-studio.vercel.app/api/canva/callback</code></li>
            <li>Scopes minimaux: <code>design:meta:read design:content:read asset:read profile:read</code></li>
            <li>Récupère Client ID + Client Secret et pose-les dans <a className="text-brand-600 hover:underline" href="/admin/api-keys">/admin/api-keys</a></li>
            <li>Active aussi le flag <code>ENABLE_CANVA_API=true</code></li>
            <li>Redéploie via le bouton sur api-keys → reviens ici → clique "Connecter"</li>
          </ol>
          <div className="rounded bg-amber-50 p-3 text-xs text-amber-900">
            <strong>Note importante</strong> : la première fois, Canva demande une review pour passer en mode production.
            En mode "Development", seul ton compte Canva peut tester. C'est OK pour démarrer.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
