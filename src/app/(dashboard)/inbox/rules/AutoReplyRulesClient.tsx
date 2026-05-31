'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  ChevronLeft,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'SPAM' | 'UNKNOWN';
export type IType = 'COMMENT' | 'MENTION' | 'DM' | 'REPLY' | 'REACTION';

export type RuleLite = {
  id: string;
  brandId: string | null;
  brandName: string | null;
  enabled: boolean;
  allowedSentiments: Sentiment[];
  allowedTypes: IType[];
  customPromptFragment: string | null;
  minSentimentScore: number;
  maxReplyLength: number;
  requireApproval: boolean;
  dailyCap: number;
};

export type BrandLite = { id: string; name: string };

const ALL_SENTIMENTS: Sentiment[] = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'SPAM', 'UNKNOWN'];
const ALL_TYPES: IType[] = ['COMMENT', 'MENTION', 'DM', 'REPLY', 'REACTION'];

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  POSITIVE: 'Positif',
  NEUTRAL: 'Neutre',
  NEGATIVE: 'Négatif',
  SPAM: 'Spam',
  UNKNOWN: 'Inconnu',
};

const TYPE_LABEL: Record<IType, string> = {
  COMMENT: 'Commentaire',
  MENTION: 'Mention',
  DM: 'Message privé',
  REPLY: 'Réponse',
  REACTION: 'Réaction',
};

function defaultDraft(): RuleLite {
  return {
    id: '',
    brandId: null,
    brandName: null,
    enabled: false,
    allowedSentiments: ['POSITIVE'],
    allowedTypes: ['COMMENT', 'MENTION'],
    customPromptFragment: '',
    minSentimentScore: 0.3,
    maxReplyLength: 280,
    requireApproval: true,
    dailyCap: 20,
  };
}

export function AutoReplyRulesClient({
  initialRules,
  brands,
}: {
  initialRules: RuleLite[];
  brands: BrandLite[];
}) {
  const [rules, setRules] = useState<RuleLite[]>(initialRules);
  const [drafts, setDrafts] = useState<Record<string, RuleLite>>(() => {
    const m: Record<string, RuleLite> = {};
    for (const r of initialRules) m[r.id] = { ...r };
    return m;
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const updateDraft = (id: string, patch: Partial<RuleLite>) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  };

  const toggleInArray = <T extends string>(arr: T[], value: T): T[] =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const handleCreate = async () => {
    setCreating(true);
    try {
      const seed = defaultDraft();
      const res = await fetch('/api/inbox/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId: null,
          enabled: seed.enabled,
          allowedSentiments: seed.allowedSentiments,
          allowedTypes: seed.allowedTypes,
          customPromptFragment: '',
          minSentimentScore: seed.minSentimentScore,
          maxReplyLength: seed.maxReplyLength,
          requireApproval: seed.requireApproval,
          dailyCap: seed.dailyCap,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Échec création');
      }
      const { data } = (await res.json()) as { data: { id: string; brandId: string | null } };
      const newRule: RuleLite = {
        ...seed,
        id: data.id,
        brandId: data.brandId,
        brandName: data.brandId ? brands.find((b) => b.id === data.brandId)?.name ?? null : null,
      };
      setRules((r) => [...r, newRule]);
      setDrafts((d) => ({ ...d, [newRule.id]: { ...newRule } }));
      toast.success('Nouvelle règle créée');
    } catch (err) {
      const e = err as Error;
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/inbox/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId: draft.brandId,
          enabled: draft.enabled,
          allowedSentiments: draft.allowedSentiments,
          allowedTypes: draft.allowedTypes,
          customPromptFragment: draft.customPromptFragment ?? '',
          minSentimentScore: draft.minSentimentScore,
          maxReplyLength: draft.maxReplyLength,
          requireApproval: draft.requireApproval,
          dailyCap: draft.dailyCap,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Échec enregistrement');
      }
      const updated: RuleLite = {
        ...draft,
        brandName: draft.brandId
          ? brands.find((b) => b.id === draft.brandId)?.name ?? null
          : null,
      };
      setRules((rs) => rs.map((r) => (r.id === id ? updated : r)));
      setDrafts((d) => ({ ...d, [id]: updated }));
      toast.success('Règle enregistrée');
    } catch (err) {
      const e = err as Error;
      toast.error(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette règle ?')) return;
    try {
      const res = await fetch(`/api/inbox/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Échec suppression');
      }
      setRules((rs) => rs.filter((r) => r.id !== id));
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      toast.success('Règle supprimée');
    } catch (err) {
      const e = err as Error;
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/inbox"
            className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft className="h-3 w-3" />
            Retour à la boîte de réception
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Règles d&apos;auto-réponse</h1>
          <p className="text-sm text-muted-foreground">
            Définis quand et comment l&apos;IA peut répondre automatiquement aux interactions sociales.
          </p>
        </div>
        <Button variant="brand" onClick={handleCreate} disabled={creating}>
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Nouvelle règle
        </Button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-10 w-10" />}
          title="Aucune règle d'auto-réponse"
          description="Crée ta première règle pour laisser l'IA répondre (avec ou sans validation humaine) aux interactions."
          action={
            <Button variant="brand" onClick={handleCreate} disabled={creating}>
              <Plus className="mr-2 h-4 w-4" />
              Créer une règle
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {rules.map((rule) => {
            const draft = drafts[rule.id] ?? rule;
            const dangerous = draft.enabled && !draft.requireApproval;
            return (
              <Card
                key={rule.id}
                className={cn(
                  'transition-colors',
                  dangerous ? 'border-amber-300 bg-amber-50/40' : '',
                )}
              >
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span>{draft.brandId ? draft.brandName ?? 'Marque' : 'Toutes les marques'}</span>
                    <Badge variant={draft.enabled ? 'success' : 'secondary'}>
                      {draft.enabled ? 'Activée' : 'Désactivée'}
                    </Badge>
                    {draft.requireApproval ? (
                      <Badge variant="outline">Validation requise</Badge>
                    ) : (
                      <Badge variant="destructive">Auto-post</Badge>
                    )}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(rule.id)}
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Supprimer
                  </Button>
                </CardHeader>

                <CardContent className="space-y-5">
                  {dangerous ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/60 p-3 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-semibold">
                          ⚠️ Mode auto-post activé.
                        </div>
                        <div>
                          L&apos;IA postera des réponses sans validation. Surveille régulièrement.
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Enabled + Approval toggles */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ToggleRow
                      label="Règle activée"
                      description="Quand désactivée, aucune auto-réponse n'est générée."
                      checked={draft.enabled}
                      onChange={(v) => updateDraft(rule.id, { enabled: v })}
                    />
                    <ToggleRow
                      label="Validation humaine requise"
                      description="Recommandé pour la sécurité de la marque."
                      checked={draft.requireApproval}
                      onChange={(v) => updateDraft(rule.id, { requireApproval: v })}
                    />
                  </div>

                  {/* Brand selector */}
                  <div className="space-y-1">
                    <Label htmlFor={`brand-${rule.id}`}>Marque</Label>
                    <select
                      id={`brand-${rule.id}`}
                      value={draft.brandId ?? ''}
                      onChange={(e) =>
                        updateDraft(rule.id, {
                          brandId: e.target.value === '' ? null : e.target.value,
                        })
                      }
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Toutes les marques (org-wide)</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Sentiments */}
                  <div className="space-y-2">
                    <Label>Sentiments autorisés</Label>
                    <div className="flex flex-wrap gap-3">
                      {ALL_SENTIMENTS.map((s) => {
                        const checked = draft.allowedSentiments.includes(s);
                        return (
                          <label
                            key={s}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                              checked
                                ? 'border-brand-500 bg-brand-50 text-brand-800'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                updateDraft(rule.id, {
                                  allowedSentiments: toggleInArray(draft.allowedSentiments, s),
                                })
                              }
                              className="h-4 w-4"
                            />
                            {SENTIMENT_LABEL[s]}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Types */}
                  <div className="space-y-2">
                    <Label>Types d&apos;interactions autorisés</Label>
                    <div className="flex flex-wrap gap-3">
                      {ALL_TYPES.map((t) => {
                        const checked = draft.allowedTypes.includes(t);
                        return (
                          <label
                            key={t}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                              checked
                                ? 'border-brand-500 bg-brand-50 text-brand-800'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                updateDraft(rule.id, {
                                  allowedTypes: toggleInArray(draft.allowedTypes, t),
                                })
                              }
                              className="h-4 w-4"
                            />
                            {TYPE_LABEL[t]}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sliders */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SliderRow
                      label="Score de sentiment minimum"
                      hint="Plus haut = plus restrictif (seules les interactions clairement positives)."
                      min={-1}
                      max={1}
                      step={0.05}
                      value={draft.minSentimentScore}
                      format={(v) => v.toFixed(2)}
                      onChange={(v) => updateDraft(rule.id, { minSentimentScore: v })}
                    />
                    <SliderRow
                      label="Longueur max. de la réponse"
                      hint="Caractères."
                      min={50}
                      max={500}
                      step={10}
                      value={draft.maxReplyLength}
                      format={(v) => `${Math.round(v)} car.`}
                      onChange={(v) =>
                        updateDraft(rule.id, { maxReplyLength: Math.round(v) })
                      }
                    />
                  </div>

                  {/* Daily cap */}
                  <div className="grid gap-2 sm:max-w-xs">
                    <Label htmlFor={`cap-${rule.id}`}>Plafond quotidien</Label>
                    <Input
                      id={`cap-${rule.id}`}
                      type="number"
                      min={0}
                      max={1000}
                      value={draft.dailyCap}
                      onChange={(e) =>
                        updateDraft(rule.id, {
                          dailyCap: Math.max(0, Math.min(1000, Number(e.target.value) || 0)),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Nombre maximum d&apos;auto-réponses par jour pour cette règle.
                    </p>
                  </div>

                  {/* Custom prompt */}
                  <div className="space-y-1">
                    <Label htmlFor={`prompt-${rule.id}`}>Instructions IA additionnelles (optionnel)</Label>
                    <Textarea
                      id={`prompt-${rule.id}`}
                      placeholder="Ex : Toujours rester chaleureux, signer avec '— L'équipe', éviter les promesses commerciales..."
                      rows={4}
                      value={draft.customPromptFragment ?? ''}
                      onChange={(e) =>
                        updateDraft(rule.id, { customPromptFragment: e.target.value })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t pt-4">
                    <Button
                      variant="brand"
                      onClick={() => handleSave(rule.id)}
                      disabled={savingId === rule.id}
                    >
                      {savingId === rule.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Enregistrer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
      <div>
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {description ? (
          <div className="text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
        role="switch"
        aria-checked={checked}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </span>
    </label>
  );
}

function SliderRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs font-mono text-slate-600">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-600"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
