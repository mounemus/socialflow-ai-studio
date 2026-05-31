'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  Ear,
  Plus,
  Play,
  Pencil,
  Trash2,
  X,
  Globe,
  MessageSquare,
  Newspaper,
  Twitter,
  Loader2,
  ArrowLeft,
  KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export type BrandLite = { id: string; name: string };

export type WatchConfig = {
  id: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  keywords: string[];
  excludeKeywords: string[];
  sources: string[];
  minRelevance: number;
  alertOnNegative: boolean;
  alertOnSpike: boolean;
  slackWebhookUrl: string | null;
  active: boolean;
  mentionCount: number;
};

const SOURCE_DEFS: { key: string; label: string; icon: React.ReactNode; requiresApiKey?: boolean }[] = [
  { key: 'REDDIT', label: 'Reddit', icon: <MessageSquare className="h-4 w-4 text-orange-500" /> },
  { key: 'WEB', label: 'Web', icon: <Globe className="h-4 w-4 text-slate-500" /> },
  { key: 'NEWS', label: 'News', icon: <Newspaper className="h-4 w-4 text-violet-500" /> },
  {
    key: 'TWITTER',
    label: 'Twitter',
    icon: <Twitter className="h-4 w-4 text-sky-500" />,
    requiresApiKey: true,
  },
];

type Draft = {
  id: string | null;
  name: string;
  brandId: string | null;
  keywords: string[];
  excludeKeywords: string[];
  sources: string[];
  minRelevance: number;
  alertOnNegative: boolean;
  alertOnSpike: boolean;
  slackWebhookUrl: string;
};

function emptyDraft(): Draft {
  return {
    id: null,
    name: '',
    brandId: null,
    keywords: [],
    excludeKeywords: [],
    sources: ['WEB', 'REDDIT', 'NEWS'],
    minRelevance: 0.5,
    alertOnNegative: true,
    alertOnSpike: false,
    slackWebhookUrl: '',
  };
}

function draftFromWatch(w: WatchConfig): Draft {
  return {
    id: w.id,
    name: w.name,
    brandId: w.brandId,
    keywords: [...w.keywords],
    excludeKeywords: [...w.excludeKeywords],
    sources: w.sources.length ? [...w.sources] : ['WEB'],
    minRelevance: w.minRelevance,
    alertOnNegative: w.alertOnNegative,
    alertOnSpike: w.alertOnSpike,
    slackWebhookUrl: w.slackWebhookUrl ?? '',
  };
}

export function WatchesClient({
  initialWatches,
  brands,
}: {
  initialWatches: WatchConfig[];
  brands: BrandLite[];
}) {
  const [watches, setWatches] = useState<WatchConfig[]>(initialWatches);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);

  const startCreate = () => setDraft(emptyDraft());
  const startEdit = (w: WatchConfig) => setDraft(draftFromWatch(w));
  const cancel = () => setDraft(null);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Donne un nom à la veille');
      return;
    }
    if (draft.keywords.length === 0) {
      toast.error('Ajoute au moins un mot-clé');
      return;
    }
    if (draft.sources.length === 0) {
      toast.error('Sélectionne au moins une source');
      return;
    }
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      brandId: draft.brandId,
      keywords: draft.keywords,
      excludeKeywords: draft.excludeKeywords,
      sources: draft.sources,
      minRelevance: draft.minRelevance,
      alertOnNegative: draft.alertOnNegative,
      alertOnSpike: draft.alertOnSpike,
      slackWebhookUrl: draft.slackWebhookUrl.trim() || null,
    };
    try {
      const editing = Boolean(draft.id);
      const res = await fetch(
        editing ? `/api/listening/watches/${encodeURIComponent(draft.id!)}` : '/api/listening/watches',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error('save failed');
      const data = (await res.json().catch(() => ({}))) as { watch?: Partial<WatchConfig> };
      const brandName = brands.find((b) => b.id === draft.brandId)?.name ?? null;
      const saved: WatchConfig = {
        id: data.watch?.id ?? draft.id ?? `tmp-${Date.now()}`,
        name: payload.name,
        brandId: draft.brandId,
        brandName,
        keywords: draft.keywords,
        excludeKeywords: draft.excludeKeywords,
        sources: draft.sources,
        minRelevance: draft.minRelevance,
        alertOnNegative: draft.alertOnNegative,
        alertOnSpike: draft.alertOnSpike,
        slackWebhookUrl: payload.slackWebhookUrl,
        active: true,
        mentionCount: watches.find((w) => w.id === draft.id)?.mentionCount ?? 0,
      };
      setWatches((prev) =>
        draft.id ? prev.map((w) => (w.id === draft.id ? saved : w)) : [saved, ...prev],
      );
      toast.success(draft.id ? 'Veille mise à jour' : 'Veille créée');
      setDraft(null);
    } catch {
      toast.error("Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }, [draft, brands, watches]);

  const remove = useCallback(async (id: string) => {
    setWatches((prev) => prev.filter((w) => w.id !== id));
    try {
      const res = await fetch(`/api/listening/watches/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('delete failed');
      toast.success('Veille supprimée');
    } catch {
      toast.error('Échec de la suppression');
    }
  }, []);

  const pollNow = useCallback(async (id: string) => {
    setPollingId(id);
    try {
      const res = await fetch(`/api/listening/watches/${encodeURIComponent(id)}/poll`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('poll failed');
      const data = (await res.json().catch(() => ({}))) as { newMentions?: number; count?: number };
      const n = data.newMentions ?? data.count ?? 0;
      toast.success(
        n > 0 ? `${n} nouvelle${n > 1 ? 's' : ''} mention${n > 1 ? 's' : ''} trouvée${n > 1 ? 's' : ''}` : 'Aucune nouvelle mention',
      );
    } catch {
      toast.error("Échec du lancement de la veille");
    } finally {
      setPollingId(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1">
            <Link
              href="/listening"
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="h-3 w-3" /> Retour à la veille
            </Link>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Ear className="h-6 w-6 text-brand-600" /> Veilles de mentions
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure les mots-clés, sources et alertes pour surveiller ta marque.
          </p>
        </div>
        {!draft ? (
          <Button variant="brand" onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" /> Nouvelle veille
          </Button>
        ) : null}
      </div>

      {draft ? (
        <WatchForm
          draft={draft}
          setDraft={setDraft}
          brands={brands}
          saving={saving}
          onSave={save}
          onCancel={cancel}
        />
      ) : null}

      {watches.length === 0 && !draft ? (
        <EmptyState
          icon={<Ear className="h-10 w-10" />}
          title="Aucune veille de mentions"
          description="Crée ta première veille pour suivre les mentions de ta marque."
          action={
            <Button variant="brand" onClick={startCreate}>
              Créer une veille
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {watches.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{w.name}</span>
                      {w.brandName ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {w.brandName}
                        </Badge>
                      ) : null}
                      <Badge variant={w.active ? 'success' : 'secondary'} className="text-[10px]">
                        {w.active ? 'Actif' : 'Pause'}
                      </Badge>
                      <span className="text-[11px] text-slate-400">
                        {w.mentionCount} mention{w.mentionCount > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {w.keywords.map((k) => (
                        <Badge key={k} variant="info" className="text-[10px]">
                          {k}
                        </Badge>
                      ))}
                      {w.excludeKeywords.map((k) => (
                        <Badge
                          key={`x-${k}`}
                          variant="outline"
                          className="text-[10px] text-rose-500 line-through"
                        >
                          {k}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        {w.sources.map((s) => {
                          const def = SOURCE_DEFS.find((d) => d.key === s.toUpperCase());
                          return def ? <span key={s}>{def.icon}</span> : null;
                        })}
                      </span>
                      <span>· pertinence ≥ {Math.round(w.minRelevance * 100)}%</span>
                      {w.alertOnNegative ? <span>· alerte négatif</span> : null}
                      {w.alertOnSpike ? <span>· alerte pic</span> : null}
                      {w.slackWebhookUrl ? <span>· Slack</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pollingId === w.id}
                      onClick={() => pollNow(w.id)}
                    >
                      {pollingId === w.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-1 h-4 w-4" />
                      )}
                      Lancer maintenant
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(w)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:text-rose-700"
                      onClick={() => remove(w.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WatchForm({
  draft,
  setDraft,
  brands,
  saving,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  brands: BrandLite[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const toggleSource = (key: string) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.sources.includes(key);
      return { ...d, sources: has ? d.sources.filter((s) => s !== key) : [...d.sources, key] };
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{draft.id ? 'Modifier la veille' : 'Nouvelle veille'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="watch-name">Nom</Label>
            <Input
              id="watch-name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ex. Mentions de ma marque"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="watch-brand">Marque</Label>
            <select
              id="watch-brand"
              value={draft.brandId ?? ''}
              onChange={(e) => patch({ brandId: e.target.value || null })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">— Aucune marque —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <TagInput
          label="Mots-clés à suivre"
          placeholder="Tape un mot-clé puis Entrée"
          tags={draft.keywords}
          onChange={(keywords) => patch({ keywords })}
          tone="info"
        />

        <TagInput
          label="Mots-clés à exclure"
          placeholder="Mots-clés qui filtrent le bruit"
          tags={draft.excludeKeywords}
          onChange={(excludeKeywords) => patch({ excludeKeywords })}
          tone="exclude"
        />

        <div className="space-y-2">
          <Label>Sources</Label>
          <div className="flex flex-wrap gap-2">
            {SOURCE_DEFS.map((s) => {
              const checked = draft.sources.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSource(s.key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    checked
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded border',
                      checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
                    )}
                  >
                    {checked ? <span className="text-[10px] leading-none">✓</span> : null}
                  </span>
                  {s.icon}
                  {s.label}
                  {s.requiresApiKey ? (
                    <span
                      className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-amber-600"
                      title="Nécessite une clé API"
                    >
                      <KeyRound className="h-3 w-3" /> clé API
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {draft.sources.includes('TWITTER') ? (
            <p className="text-[11px] text-amber-600">
              Twitter nécessite une clé API configurée dans les paramètres d&apos;intégration.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="watch-relevance">Pertinence minimale</Label>
            <span className="text-sm font-semibold text-brand-600">
              {Math.round(draft.minRelevance * 100)}%
            </span>
          </div>
          <input
            id="watch-relevance"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(draft.minRelevance * 100)}
            onChange={(e) => patch({ minRelevance: Number(e.target.value) / 100 })}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
          />
          <p className="text-[11px] text-slate-500">
            Filtre les mentions sous ce seuil de pertinence estimée.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            label="Alerter sur les mentions négatives"
            checked={draft.alertOnNegative}
            onChange={(alertOnNegative) => patch({ alertOnNegative })}
          />
          <Toggle
            label="Alerter sur un pic de mentions"
            checked={draft.alertOnSpike}
            onChange={(alertOnSpike) => patch({ alertOnSpike })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="watch-slack">Webhook Slack (optionnel)</Label>
          <Input
            id="watch-slack"
            value={draft.slackWebhookUrl}
            onChange={(e) => patch({ slackWebhookUrl: e.target.value })}
            placeholder="https://hooks.slack.com/services/..."
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Annuler
          </Button>
          <Button variant="brand" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {draft.id ? 'Enregistrer' : 'Créer la veille'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TagInput({
  label,
  placeholder,
  tags,
  onChange,
  tone,
}: {
  label: string;
  placeholder: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  tone: 'info' | 'exclude';
}) {
  const [value, setValue] = useState('');

  const commit = () => {
    const v = value.trim();
    if (!v) return;
    if (!tags.some((t) => t.toLowerCase() === v.toLowerCase())) {
      onChange([...tags, v]);
    }
    setValue('');
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-2">
        {tags.map((t) => (
          <span
            key={t}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              tone === 'exclude' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-800',
            )}
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="opacity-60 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !value && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={placeholder}
          className="min-w-[140px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
    >
      <span className="text-slate-700">{label}</span>
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
