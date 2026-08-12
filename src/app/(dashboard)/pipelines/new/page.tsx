'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { createPipelineInput } from '@/lib/contracts';

type Horizon = '30d' | '90d' | '12mo';

export default function NewPipelinePage() {
  return (
    <Suspense>
      <NewPipelineForm />
    </Suspense>
  );
}

type LinkedBrand = { id: string; name: string; industry: string | null };
type BrandStrategy = { id: string; title: string; status: string; _count: { items: number } };

const STRATEGY_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'brouillon',
  VALIDATED: 'validée',
  IN_EXECUTION: 'en exécution',
  ARCHIVED: 'archivée',
};

function NewPipelineForm() {
  const router = useRouter();
  const sp = useSearchParams();
  // Enchaînement « Orbit » : la stratégie se lance TOUJOURS pour la marque du
  // contexte — soit via ?brandId= (arrivée depuis « créer une marque »), soit
  // via la marque active du sélecteur global. On ne redemande jamais de créer
  // une marque quand une marque est déjà sélectionnée.
  const queryBrandId = sp.get('brandId');
  const [linked, setLinked] = useState<LinkedBrand | null>(null);
  const [brandResolved, setBrandResolved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [strategies, setStrategies] = useState<BrandStrategy[]>([]);
  // '' = auto (la plus récente) · 'new' = génération neuve · sinon id précis
  const [strategyChoice, setStrategyChoice] = useState('');
  const [form, setForm] = useState({
    name: sp.get('name') ?? '',
    industry: sp.get('industry') ?? '',
    description: sp.get('description') ?? '',
    website: '',
    audienceHint: '',
    horizon: '90d' as Horizon,
    language: 'fr',
  });

  useEffect(() => {
    fetch('/api/me/active-brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const brands = (d?.data?.brands ?? []) as LinkedBrand[];
        const targetId = queryBrandId ?? (d?.data?.activeBrandId as string | null);
        const b = targetId ? brands.find((x) => x.id === targetId) : null;
        if (b) {
          setLinked(b);
          // Récupère TOUT ce qui est déjà établi sur la marque — plus de
          // ressaisie de la description ni de l'audience.
          const extra = b as LinkedBrand & { description?: string | null; profile?: { audienceTarget?: string | null } | null };
          setForm((f) => ({
            ...f,
            name: f.name || b.name,
            industry: f.industry || (b.industry ?? ''),
            description: f.description || (extra.description ?? ''),
            audienceHint: f.audienceHint || (extra.profile?.audienceTarget ?? ''),
          }));
        }
      })
      .finally(() => setBrandResolved(true));
  }, [queryBrandId]);

  // Stratégies existantes de la marque liée — proposées au choix pour l'Acte 3.
  useEffect(() => {
    if (!linked) { setStrategies([]); setStrategyChoice(''); return; }
    fetch(`/api/strategy?brandId=${linked.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = ((d?.data ?? []) as BrandStrategy[]).filter((s) => s.status !== 'ARCHIVED' && s._count.items > 0);
        setStrategies(list);
      })
      .catch(() => setStrategies([]));
  }, [linked]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Le nom de la marque est requis');
      return;
    }
    setLoading(true);
    // Payload construit via le contrat partagé : impossible d'envoyer une clé
    // que l'API rejetterait (cf. src/lib/contracts).
    const payload = createPipelineInput.parse({
      brandSeed: {
        name: form.name.trim(),
        industry: form.industry.trim() || undefined,
        description: form.description.trim() || undefined,
        website: form.website.trim() || undefined,
        audienceHint: form.audienceHint.trim() || undefined,
      },
      horizon: form.horizon,
      language: form.language,
      ...(linked ? { brandId: linked.id } : {}),
      ...(strategyChoice === 'new'
        ? { forceNewStrategy: true }
        : strategyChoice
          ? { strategyId: strategyChoice }
          : {}),
    });
    const res = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? `Lancement impossible (HTTP ${res.status})`);
      return;
    }
    const { data } = await res.json();
    const pipelineId = data?.pipeline?.id ?? data?.id;
    if (!pipelineId) {
      toast.error('Pipeline lancé mais identifiant introuvable — voir la liste des pipelines');
      router.push('/pipelines');
      return;
    }
    toast.success('Pipeline lancé');
    router.push(`/pipelines/${pipelineId}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            Nouveau pipeline
          </CardTitle>
          <CardDescription>
            {linked
              ? `L’IA va enrichir le profil de ${linked.name}, générer sa stratégie et planifier les publications — avec validation à chaque étape critique.`
              : 'Décris ta marque en quelques mots. L’agent IA va enrichir le profil, générer une stratégie complète et planifier les publications — avec validation à chaque étape critique.'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {linked ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-500/30 bg-brand-50 px-4 py-3">
                <div className="text-sm">
                  <span className="font-semibold">Marque : {linked.name}</span>
                  {linked.industry ? (
                    <span className="text-muted-foreground"> · {linked.industry}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => {
                    // Repart d'un formulaire vierge — sinon on créerait une
                    // marque homonyme sans le vouloir.
                    setLinked(null);
                    setForm((f) => ({ ...f, name: '', industry: '', description: '', audienceHint: '' }));
                  }}
                >
                  Développer une autre marque ?
                </button>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="name">Nom de la marque *</Label>
              <Input
                id="name"
                required
                placeholder="Acme Studio"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  // Changer le nom = créer une NOUVELLE marque distincte, jamais
                  // fusionner avec la marque liée.
                  if (linked && name.trim() !== linked.name) {
                    setLinked(null);
                    toast.info(`Nouvelle marque distincte — aucune fusion avec ${linked.name}.`);
                  }
                  setForm((f) => ({ ...f, name }));
                }}
                disabled={!brandResolved}
              />
              {linked ? (
                <p className="text-[11px] text-muted-foreground">
                  Pipeline lié à « {linked.name} » — change le nom pour créer une nouvelle marque distincte.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industrie</Label>
              <Input
                id="industry"
                placeholder="SaaS B2B, e-commerce mode, restauration..."
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Site web</Label>
              <Input
                id="website"
                type="url"
                placeholder="https://exemple.com"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={3}
                placeholder="Que fait la marque, pour qui, qu'est-ce qui la rend unique ?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audienceHint">Audience cible (indice)</Label>
              <Input
                id="audienceHint"
                placeholder="Femmes 25-40, urbaines, sensibles à l'éco-responsabilité"
                value={form.audienceHint}
                onChange={(e) => setForm({ ...form, audienceHint: e.target.value })}
              />
            </div>
            {linked && strategies.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="strategy">Stratégie pour l&apos;Acte 3</Label>
                <select
                  id="strategy"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={strategyChoice}
                  onChange={(e) => setStrategyChoice(e.target.value)}
                >
                  <option value="">Automatique — réutilise la plus récente</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s._count.items} items · {STRATEGY_STATUS_LABEL[s.status] ?? s.status})
                    </option>
                  ))}
                  <option value="new">✨ Générer une nouvelle stratégie</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  La stratégie choisie est adoptée telle quelle : ses items alimentent la validation (Acte 3-4) puis la production (Acte 5).
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="horizon">Horizon stratégique</Label>
                <select
                  id="horizon"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.horizon}
                  onChange={(e) => setForm({ ...form, horizon: e.target.value as Horizon })}
                >
                  <option value="30d">30 jours</option>
                  <option value="90d">90 jours</option>
                  <option value="12mo">12 mois</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="language">Langue</Label>
                <select
                  id="language"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Annuler
            </Button>
            <Button type="submit" variant="brand" disabled={loading}>
              {loading ? 'Lancement…' : 'Lancer le pipeline'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
