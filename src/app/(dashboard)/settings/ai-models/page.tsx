'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Type, Image as ImageIcon, Clapperboard } from 'lucide-react';

type Category = 'TEXT' | 'IMAGE' | 'VIDEO';
interface CatalogModel { id: string; label: string; costTier: string; note?: string }
interface CatalogProvider { id: string; label: string; configured: boolean; models: CatalogModel[] }
interface Pref { mode: 'AUTO' | 'FORCED'; provider: string | null; model: string | null }

const CATEGORY_META: Record<Category, { label: string; icon: typeof Type; desc: string }> = {
  TEXT: { label: 'Génération de texte', icon: Type, desc: 'Posts, captions, stratégies, scripts.' },
  IMAGE: { label: 'Génération d’images', icon: ImageIcon, desc: 'Visuels, carrousels, vignettes.' },
  VIDEO: { label: 'Génération vidéo / animation', icon: Clapperboard, desc: 'Clips courts texte → vidéo (fal.ai, Replicate).' },
};

/**
 * Choix des modèles IA par catégorie.
 * AUTO (recommandé) : l'orchestrateur choisit selon la tâche, la fiabilité
 * observée (7 j) et le coût. FORCÉ : le modèle sélectionné est toujours
 * utilisé en premier (avec fallback automatique en cas de panne).
 */
export default function AIModelsSettingsPage() {
  const [prefs, setPrefs] = useState<Record<Category, Pref> | null>(null);
  const [catalog, setCatalog] = useState<Record<Category, CatalogProvider[]> | null>(null);
  const [busy, setBusy] = useState<Category | null>(null);

  async function load() {
    const res = await fetch('/api/ai/model-preferences');
    if (!res.ok) return toast.error('Chargement impossible');
    const { data } = await res.json();
    setPrefs(data.prefs);
    setCatalog(data.catalog);
  }
  useEffect(() => { load(); }, []);

  async function save(category: Category, pref: Pref) {
    setBusy(category);
    try {
      const res = await fetch('/api/ai/model-preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, mode: pref.mode, provider: pref.provider ?? undefined, model: pref.model ?? undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Sauvegarde impossible');
      }
      toast.success(`${CATEGORY_META[category].label} : ${pref.mode === 'AUTO' ? 'orchestrateur (AUTO)' : `${pref.provider} · ${pref.model}`}`);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!prefs || !catalog) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Modèles IA</h1>
        <p className="text-sm text-muted-foreground">
          Par catégorie : laisse l’orchestrateur choisir (AUTO — tâche, fiabilité observée, coût),
          ou impose un modèle précis. En cas de panne du modèle forcé, le fallback automatique
          prend le relais — jamais de blocage.
        </p>
      </div>

      {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
        const meta = CATEGORY_META[cat];
        const Icon = meta.icon;
        const pref = prefs[cat];
        const providers = catalog[cat] ?? [];
        return (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="h-4 w-4" /> {meta.label}
                {pref.mode === 'AUTO' ? (
                  <Badge variant="info"><Sparkles className="mr-1 h-3 w-3" />Orchestrateur (AUTO)</Badge>
                ) : (
                  <Badge variant="success">Forcé : {pref.provider} · {pref.model}</Badge>
                )}
              </CardTitle>
              <CardDescription>{meta.desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={pref.mode === 'AUTO' ? 'brand' : 'outline'}
                  disabled={busy === cat}
                  onClick={() => save(cat, { mode: 'AUTO', provider: null, model: null })}
                >
                  <Sparkles className="mr-1 h-3 w-3" /> AUTO (recommandé)
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {providers.map((p) => (
                  <div key={p.id} className={`rounded-lg border p-3 ${!p.configured ? 'opacity-50' : ''}`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium">{p.label}</span>
                      <Badge variant={p.configured ? 'success' : 'secondary'} className="text-[10px]">
                        {p.configured ? 'configuré' : 'clé absente'}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {p.models.map((m) => {
                        const active = pref.mode === 'FORCED' && pref.provider === p.id && pref.model === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            disabled={!p.configured || busy === cat}
                            onClick={() => save(cat, { mode: 'FORCED', provider: p.id, model: m.id })}
                            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                              active ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                            }`}
                          >
                            <span>
                              {m.label}
                              {m.note ? <span className={active ? 'text-slate-300' : 'text-muted-foreground'}> — {m.note}</span> : null}
                            </span>
                            <span className="font-mono">{m.costTier}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
