'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/client-api-error';
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  RefreshCw,
  Eye,
  Pencil,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

export type Act4Provider = 'auto' | 'gemini' | 'dalle' | 'flux';

export interface Act4Variant {
  url: string;
  provider?: string;
  mediaId?: string;
  prompt?: string;
}

export interface Act4Item {
  id: string;
  title?: string | null;
  brief?: string | null;
  description?: string | null;
  platform?: string | null;
  status?: string | null;
  postId?: string | null;
  caption?: string | null;
  prompt?: string | null;
  variants?: Act4Variant[] | null;
  thumbnailUrl?: string | null;
  readyAt?: string | null;
}

export interface Act4Run {
  step?: string;
  status?: string;
  strategy?: { items?: Act4Item[] } | null;
  itemStates?: Record<string, { status?: string; postId?: string } | unknown> | null;
  /** Items the parent has already moved into act5 (so Act4 can stop showing them) */
  readyItemIds?: string[];
}

export interface Act4ConcretizationProps {
  pipelineId: string;
  run?: Act4Run | null;
  onChanged?: () => void;
  /** Called when user marks an item ready (so the parent can stack Act5 below it) */
  onItemReady?: (itemId: string) => void;
  /** Optional renderer slot — PipelineRunner injects a richer platform mockup. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PreviewRenderer?: (props: any) => ReactNode;
  // Permissive: PipelineRunner spreads a shared bag of helpers into every Act.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}

const PROVIDER_OPTIONS: Array<{ value: Act4Provider; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'dalle', label: 'DALL-E' },
  { value: 'flux', label: 'FLUX' },
];

/**
 * Renders a small platform preview using the item's caption + first visual.
 * Lightweight — heavy mockup chrome is left to the parent's PreviewRenderer
 * if it wants to swap us out via a slot. We expose itemId so a wrapper can
 * portal a richer preview in.
 */
function MiniPreview({
  item,
  selectedVariantUrl,
  caption,
}: {
  item: Act4Item;
  selectedVariantUrl?: string;
  caption: string;
}) {
  const visual = selectedVariantUrl ?? item.variants?.[0]?.url ?? item.thumbnailUrl ?? null;
  const platform = (item.platform ?? 'social').toLowerCase();
  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b bg-slate-50 px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          {platform}
        </span>
        <span className="text-[10px] text-slate-400">preview</span>
      </div>
      <div className="aspect-square w-full bg-slate-100">
        {visual ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={visual}
            alt={item.title ?? 'preview'}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            Aucun visuel
          </div>
        )}
      </div>
      <div className="space-y-1 p-2">
        <p className="line-clamp-4 whitespace-pre-wrap text-[11px] text-slate-700">
          {caption || <span className="italic text-slate-400">Pas de caption</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * Acte 4 — Concrétisation : pour chaque item approuvé, génère visuel + caption,
 * permet régénération multi-provider et édition, puis "Marquer prêt".
 */
export function Act4Concretization({
  pipelineId,
  run,
  onChanged,
  onItemReady,
}: Act4ConcretizationProps) {
  const items = useMemo(() => {
    const all = run?.strategy?.items ?? [];
    const states = (run?.itemStates ?? {}) as Record<
      string,
      { status?: string; postId?: string }
    >;
    const readySet = new Set(run?.readyItemIds ?? []);
    return all.filter((it) => {
      if (readySet.has(it.id)) return false;
      const s = states[it.id]?.status ?? it.status;
      return s === 'APPROVED' || s === 'EDITED' || s === 'EXECUTED';
    });
  }, [run]);

  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [providerByItem, setProviderByItem] = useState<Record<string, Act4Provider>>({});
  const [selectedVariant, setSelectedVariant] = useState<Record<string, number>>({});
  const [showVariants, setShowVariants] = useState<Record<string, boolean>>({});
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState<Record<string, string>>({});
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState<Record<string, string>>({});
  const [concretizing, setConcretizing] = useState<Record<string, boolean>>({});
  const concretizedRef = useRef<Set<string>>(new Set());

  // Seed caption / prompt drafts.
  useEffect(() => {
    setCaptionDraft((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (next[it.id] === undefined) next[it.id] = it.caption ?? '';
      }
      return next;
    });
    setPromptDraft((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (next[it.id] === undefined) next[it.id] = it.prompt ?? '';
      }
      return next;
    });
  }, [items]);

  // Auto-trigger concretization for each item once, on mount/items change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items) {
        if (concretizedRef.current.has(it.id)) continue;
        if (it.variants && it.variants.length > 0) {
          concretizedRef.current.add(it.id);
          continue;
        }
        concretizedRef.current.add(it.id);
        if (cancelled) return;
        setConcretizing((s) => ({ ...s, [it.id]: true }));
        try {
          const res = await fetch(
            `/api/pipelines/${pipelineId}/items/${it.id}/concretize`,
            { method: 'POST' },
          );
          if (!res.ok) {
            // silent — surface via toast only on hard errors
            const txt = await res.text().catch(() => '');
            if (txt && !cancelled) {
              toast.error(`Concretize ${it.title ?? it.id}: ${txt.slice(0, 80)}`);
            }
          }
        } catch (err) {
          if (!cancelled) {
            toast.error(`Concretize failed: ${(err as Error).message.slice(0, 80)}`);
          }
        } finally {
          if (!cancelled) {
            setConcretizing((s) => ({ ...s, [it.id]: false }));
            onChanged?.();
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, items.map((i) => i.id).join('|')]);

  // Pendant qu'au moins un item se concrétise, on rafraîchit toutes les 5 s :
  // la persistance serveur est progressive (caption d'abord, puis chaque
  // visuel) — l'utilisateur voit le travail apparaître au fil de l'eau au lieu
  // d'un spinner muet.
  const anyConcretizing = Object.values(concretizing).some(Boolean);
  useEffect(() => {
    if (!anyConcretizing) return;
    const t = setInterval(() => onChanged?.(), 5000);
    return () => clearInterval(t);
  }, [anyConcretizing, onChanged]);

  // === ACTIONS ===
  const regenerateVisual = useCallback(
    async (item: Act4Item) => {
      setBusyItem(item.id);
      try {
        const provider = providerByItem[item.id] ?? 'auto';
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${item.id}/concretize`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider, regenerate: true }),
          },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success(`Visuel régénéré (${provider})`);
        onChanged?.();
      } catch (err) {
        toast.error(`Régénération échouée: ${(err as Error).message.slice(0, 100)}`);
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, providerByItem, onChanged],
  );

  const saveCaption = useCallback(
    async (item: Act4Item) => {
      setBusyItem(item.id);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${item.id}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caption: captionDraft[item.id] ?? '' }),
          },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Caption enregistrée');
        setEditingCaption(null);
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, captionDraft, onChanged],
  );

  const savePrompt = useCallback(
    async (item: Act4Item) => {
      setBusyItem(item.id);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${item.id}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt: promptDraft[item.id] ?? '' }),
          },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Prompt source enregistré');
        setEditingPrompt(null);
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, promptDraft, onChanged],
  );

  const markReady = useCallback(
    async (item: Act4Item) => {
      setBusyItem(item.id);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${item.id}/ready`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success(`${item.title ?? 'Item'} prêt à publier`);
        onItemReady?.(item.id);
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, onItemReady, onChanged],
  );

  const headerBadge =
    items.length === 0 ? (
      <Badge variant="secondary" className="text-[10px]">VIDE</Badge>
    ) : (
      <Badge variant="info" className="text-[10px]">EN COURS</Badge>
    );

  return (
    <Card
      className="border-fuchsia-200 bg-fuchsia-50/20"
      data-act="4"
      data-pipeline-id={pipelineId}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Acte 4 · CONCRÉTISATION</span>
          {headerBadge}
        </CardTitle>
        <Sparkles className="h-5 w-5 text-fuchsia-600" />
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm italic text-slate-500">
            Aucun item approuvé à concrétiser. Approuvez des items dans l'Acte 3.
          </p>
        ) : null}

        {items.map((item) => {
          const provider = providerByItem[item.id] ?? 'auto';
          const variants = item.variants ?? [];
          const selectedIdx = selectedVariant[item.id] ?? 0;
          const selected = variants[selectedIdx] ?? variants[0];
          const isBusy = busyItem === item.id;
          const isConcretizing = concretizing[item.id];

          return (
            <div
              key={item.id}
              className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 lg:grid-cols-[260px_minmax(0,1fr)_240px]"
            >
              {/* === LEFT: brief === */}
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  {item.platform ? (
                    <Badge variant="info" className="text-[9px]">
                      {item.platform}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-[9px]">
                    Item
                  </Badge>
                </div>
                <h5 className="text-sm font-semibold text-slate-800">
                  {item.title ?? 'Sans titre'}
                </h5>
                <p className="text-[11px] text-slate-600">
                  {item.brief ?? item.description ?? ''}
                </p>
                {item.prompt && editingPrompt !== item.id ? (
                  <p className="mt-1 line-clamp-2 rounded bg-slate-50 p-1 font-mono text-[10px] text-slate-500">
                    prompt: {item.prompt}
                  </p>
                ) : null}
                {editingPrompt === item.id ? (
                  <div className="space-y-1">
                    <Textarea
                      rows={3}
                      className="font-mono text-[10px]"
                      value={promptDraft[item.id] ?? ''}
                      onChange={(e) =>
                        setPromptDraft((p) => ({ ...p, [item.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="brand"
                        className="h-6 text-[10px]"
                        onClick={() => savePrompt(item)}
                        disabled={isBusy}
                      >
                        Enregistrer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px]"
                        onClick={() => setEditingPrompt(null)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* === CENTER: preview === */}
              <div className="space-y-2">
                {isConcretizing ? (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-slate-50 text-xs text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Concrétisation IA…
                  </div>
                ) : (
                  <MiniPreview
                    item={item}
                    selectedVariantUrl={selected?.url}
                    caption={captionDraft[item.id] ?? item.caption ?? ''}
                  />
                )}

                {showVariants[item.id] && variants.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1">
                    {variants.slice(0, 3).map((v, i) => (
                      <button
                        key={`${v.url}-${i}`}
                        type="button"
                        onClick={() =>
                          setSelectedVariant((s) => ({ ...s, [item.id]: i }))
                        }
                        className={
                          'overflow-hidden rounded border-2 ' +
                          (selectedIdx === i
                            ? 'border-fuchsia-500'
                            : 'border-transparent hover:border-slate-300')
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={v.url}
                          alt={`variant ${i + 1}`}
                          className="aspect-square w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ) : null}

                {editingCaption === item.id ? (
                  <div className="space-y-1">
                    <Textarea
                      rows={4}
                      className="text-xs"
                      value={captionDraft[item.id] ?? ''}
                      onChange={(e) =>
                        setCaptionDraft((p) => ({ ...p, [item.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="brand"
                        className="h-6 text-[10px]"
                        onClick={() => saveCaption(item)}
                        disabled={isBusy}
                      >
                        Enregistrer caption
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px]"
                        onClick={() => setEditingCaption(null)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* === RIGHT: actions === */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Provider visuel
                  </label>
                  <select
                    value={provider}
                    onChange={(e) =>
                      setProviderByItem((p) => ({
                        ...p,
                        [item.id]: e.target.value as Act4Provider,
                      }))
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    disabled={isBusy || isConcretizing}
                  >
                    {PROVIDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-[10px]"
                  onClick={() => regenerateVisual(item)}
                  disabled={isBusy || isConcretizing}
                >
                  {isBusy ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3 w-3" />
                  )}
                  Régénérer visuel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-[10px]"
                  onClick={() =>
                    setShowVariants((s) => ({ ...s, [item.id]: !s[item.id] }))
                  }
                  disabled={variants.length === 0}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Voir variantes ({variants.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-[10px]"
                  onClick={() => setEditingCaption(item.id)}
                  disabled={isBusy}
                >
                  <Pencil className="mr-1 h-3 w-3" /> Éditer caption
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-[10px]"
                  onClick={() => setEditingPrompt(item.id)}
                  disabled={isBusy}
                >
                  <RefreshCw className="mr-1 h-3 w-3" /> Éditer prompt source
                </Button>
                <Button
                  size="sm"
                  variant="brand"
                  className="w-full text-[10px]"
                  onClick={() => markReady(item)}
                  disabled={isBusy || isConcretizing}
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Marquer prêt
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default Act4Concretization;
