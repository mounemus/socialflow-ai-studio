'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/client-api-error';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  RefreshCw,
  Eye,
  Pencil,
  Send,
  CalendarClock,
  Share2,
  Link2,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { postStatusMeta } from '@/lib/post-status';
import { publishPostInput, schedulePostInput } from '@/lib/contracts';
import { ManualShareDialog } from '@/components/share/ManualShareDialog';
import type { ItemPublicationView, PublicationMap } from '@/lib/pipeline-publication';

export type Act4Provider = 'auto' | 'gemini' | 'dalle' | 'gpt-image' | 'flux' | 'fal';

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
  /** Ligne brute : la concrétisation vit dans metadata.concretization. */
  metadata?: Record<string, unknown> | null;
}

export interface Act4Run {
  step?: string;
  status?: string;
  strategy?: { items?: Act4Item[] } | null;
  itemStates?: Record<string, { status?: string; postId?: string } | unknown> | null;
  /** Items the parent has already moved into act5 (so Act4 can stop showing them) */
  readyItemIds?: string[];
  /** État réel de publication par item (statut du post + destination résolue). */
  publication?: PublicationMap;
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
  { value: 'fal', label: 'fal.ai (FLUX)' },
  { value: 'gemini', label: 'Gemini (Nano Banana)' },
  { value: 'gpt-image', label: 'GPT Image (OpenAI)' },
  { value: 'dalle', label: 'DALL-E 3' },
  { value: 'flux', label: 'FLUX (Replicate)' },
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
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-slate-400">
            <span>Aucun visuel généré pour l&apos;instant</span>
            <span className="text-[10px]">
              Cliquez « Régénérer visuel » à droite — le texte ci-dessous est déjà l&apos;aperçu réel.
            </span>
          </div>
        )}
      </div>
      <div className="space-y-1 p-2">
        {/* Aperçu fidèle : caption concrétisée, sinon le brief de l'item —
            jamais une zone vide qui laisse croire que rien n'existe. */}
        <p className="line-clamp-6 whitespace-pre-wrap text-[11px] text-slate-700">
          {caption || item.description || (
            <span className="italic text-slate-400">Pas encore de texte — générez la caption.</span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Acte 4 — Produire & publier : pour chaque contenu validé, génère visuel +
 * caption (régénération multi-provider, édition), affiche la DESTINATION
 * réelle (compte / passerelle / partage manuel, simulation ou non) et permet
 * de PROGRAMMER ou PUBLIER directement — par carte ou en lot. Le statut
 * affiché est celui du post (source unique `post-status.ts`).
 */
export function Act4Concretization({
  pipelineId,
  run,
  onChanged,
}: Act4ConcretizationProps) {
  const items = useMemo(() => {
    const all = run?.strategy?.items ?? [];
    const states = (run?.itemStates ?? {}) as Record<
      string,
      { status?: string; postId?: string }
    >;
    const readySet = new Set(run?.readyItemIds ?? []);
    return all
      .filter((it) => {
        if (readySet.has(it.id)) return false;
        const s = states[it.id]?.status ?? it.status;
        return s === 'APPROVED' || s === 'EDITED' || s === 'EXECUTED';
      })
      .map((it) => {
        // Les visuels et la caption vivent dans metadata.concretization
        // (écrits par ConcretizationService). Sans ce mappage, l'aperçu
        // restait « Aucun visuel » alors que l'image existait en base.
        const conc = ((it.metadata as Record<string, unknown> | null)?.concretization ?? {}) as {
          caption?: string;
          imageUrls?: string[];
          variants?: Act4Variant[];
          imagePrompt?: string;
          provider?: string;
        };
        const fromMeta: Act4Variant[] =
          conc.variants && conc.variants.length > 0
            ? conc.variants
            : (conc.imageUrls ?? []).map((url) => ({ url, provider: conc.provider }));
        // Une concrétisation a-t-elle DÉJÀ été tentée pour cet item ? Présence
        // d'un payload `metadata.concretization` (même sans visuel réussi) OU
        // statut EXECUTED. Sert à ne PLUS relancer l'auto-génération à chaque
        // (re)montage de la page — sinon l'Acte 4 régénérait des images en
        // boucle et brûlait des appels IA.
        //
        // EXCEPTION — concrétisation « dégénérée » : caption absente ou égale
        // au brief brut de l'item (post fantôme hérité, échec IA passé). Dans
        // ce cas on RE-concrétise : sinon le prompt partait tel quel en
        // publication (« le texte récupère les prompts »). Pas de boucle : une
        // vraie caption générée diffère toujours du brief.
        const degenerate =
          !conc.caption || conc.caption.trim() === (it.description ?? '').trim();
        const attempted =
          (Object.keys(conc).length > 0 || (it.status ?? '') === 'EXECUTED') && !degenerate;
        return {
          ...it,
          caption: it.caption ?? conc.caption ?? null,
          variants: it.variants && it.variants.length > 0 ? it.variants : fromMeta,
          thumbnailUrl: it.thumbnailUrl ?? conc.imageUrls?.[0] ?? null,
          prompt: it.prompt ?? conc.imagePrompt ?? null,
          postId: it.postId ?? states[it.id]?.postId ?? null,
          _attempted: attempted,
        };
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
  const [bulkBusy, setBulkBusy] = useState(false);
  const [assisting, setAssisting] = useState<string | null>(null);

  /** Génération IA à la demande — remplit l'éditeur, l'utilisateur garde la main. */
  const assist = useCallback(
    async (item: Act4Item, kind: 'caption' | 'prompt') => {
      setAssisting(`${item.id}:${kind}`);
      try {
        const res = await fetch(`/api/pipelines/${pipelineId}/items/${item.id}/assist`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        const { data } = await res.json();
        const text = (data as { text?: string })?.text ?? '';
        if (!text) throw new Error('Génération vide — réessaie');
        if (kind === 'caption') setCaptionDraft((p) => ({ ...p, [item.id]: text }));
        else setPromptDraft((p) => ({ ...p, [item.id]: text }));
        toast.success(kind === 'caption'
          ? 'Caption régénérée (marque + ADN + stratégie) — ajuste puis enregistre.'
          : 'Prompt visuel généré par le directeur artistique IA — scène sans texte.');
      } catch (err) {
        toast.error((err as Error).message.slice(0, 120));
      } finally {
        setAssisting(null);
      }
    },
    [pipelineId],
  );
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
        // Déjà un visuel OU déjà tentée (payload de concrétisation présent) :
        // on ne relance JAMAIS l'auto-génération. Un nouveau visuel ne se
        // produit que via « Régénérer visuel » (action explicite).
        if ((it.variants && it.variants.length > 0) || it._attempted) {
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

  // La persistance serveur est progressive (caption d'abord, puis chaque
  // visuel) : l'utilisateur voit le travail apparaître au fil de l'eau grâce au
  // poll de PipelineRunner (5 s) + l'appel `onChanged` émis après chaque item
  // concrétisé ci-dessus. Pas d'intervalle supplémentaire ici.

  // === ACTIONS ===
  const regenerateVisual = useCallback(
    async (item: Act4Item) => {
      setBusyItem(item.id);
      try {
        const provider = providerByItem[item.id] ?? 'auto';
        // Route dédiée à la régénération (l'ancienne cible /concretize ignorait
        // silencieusement le champ envoyé : le client postait `provider` alors
        // que le schéma n'accepte que `forceProvider`, et Zod supprime les clés
        // inconnues — le sélecteur de provider n'avait donc aucun effet).
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${item.id}/regenerate-visual`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              provider === 'auto' ? {} : { providerOverride: provider },
            ),
          },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        // Vérité opérationnelle : un 200 ne prouve pas qu'une image existe.
        // On ne parle de succès que si le serveur confirme un visuel réel.
        const json = (await res.json().catch(() => ({}))) as {
          data?: { visualProduced?: boolean; visualIssue?: string; provider?: string };
        };
        const result = json.data;
        if (result?.visualProduced === false) {
          toast.error(
            `Aucun visuel généré — ${result.visualIssue ?? 'raison inconnue'}`,
            { duration: 8000 },
          );
        } else {
          toast.success(`Visuel régénéré (${result?.provider ?? provider})`);
        }
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

  // ---- Publication directe depuis l'Acte 4 -------------------------------
  const publication = (run?.publication ?? {}) as PublicationMap;
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [scheduleOpen, setScheduleOpen] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState<Record<string, string>>({});
  const [shareFor, setShareFor] = useState<Act4Item | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStart, setBulkStart] = useState('');

  const pubOf = useCallback((id: string): ItemPublicationView | undefined => publication[id], [publication]);

  const publishOne = useCallback(
    async (item: Act4Item, opts: { silent?: boolean } = {}): Promise<'published' | 'manual' | 'error'> => {
      if (!item.postId) return 'error';
      setPublishing((p) => ({ ...p, [item.id]: true }));
      try {
        const res = await fetch(`/api/posts/${item.postId}/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(publishPostInput.parse(item.platform ? { platform: item.platform } : {})),
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: { mode?: string; result?: { success?: boolean; simulated?: boolean; error?: string }; message?: string };
          message?: string;
        };
        if (!res.ok) throw new Error(json?.message ?? (await apiErrorMessage(res)));
        const d = json.data ?? {};
        if (d.mode === 'MANUAL') {
          if (!opts.silent) toast.info(d.message ?? 'Aucun compte connecté — partage manuel.');
          return 'manual';
        }
        if (d.result && d.result.success === false) {
          throw new Error(d.result.error ?? 'Le réseau a refusé la publication');
        }
        if (!opts.silent) {
          toast.success(
            d.result?.simulated
              ? `${item.title ?? 'Contenu'} — publication SIMULÉE (mode réel désactivé)`
              : `${item.title ?? 'Contenu'} publié ✓`,
          );
        }
        return 'published';
      } catch (err) {
        if (!opts.silent) toast.error(`Publication échouée : ${(err as Error).message.slice(0, 140)}`);
        return 'error';
      } finally {
        setPublishing((p) => ({ ...p, [item.id]: false }));
        onChanged?.();
      }
    },
    [onChanged],
  );

  const scheduleOne = useCallback(
    async (item: Act4Item, when: Date, opts: { silent?: boolean } = {}): Promise<'scheduled' | 'error'> => {
      if (!item.postId) return 'error';
      setPublishing((p) => ({ ...p, [item.id]: true }));
      try {
        const res = await fetch(`/api/posts/${item.postId}/schedule`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            schedulePostInput.parse({
              scheduledFor: when.toISOString(),
              ...(item.platform ? { platform: item.platform } : {}),
            }),
          ),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: { mode?: string }; message?: string };
        if (!res.ok) throw new Error(json?.message ?? (await apiErrorMessage(res)));
        if (!opts.silent) {
          toast.success(
            json.data?.mode === 'MANUAL'
              ? `${item.title ?? 'Contenu'} programmé (partage manuel — aucun compte connecté)`
              : `${item.title ?? 'Contenu'} programmé pour le ${when.toLocaleString('fr-CA')}`,
          );
        }
        setScheduleOpen(null);
        return 'scheduled';
      } catch (err) {
        if (!opts.silent) toast.error(`Programmation échouée : ${(err as Error).message.slice(0, 140)}`);
        return 'error';
      } finally {
        setPublishing((p) => ({ ...p, [item.id]: false }));
        onChanged?.();
      }
    },
    [onChanged],
  );

  const recreateDraft = useCallback(
    async (item: Act4Item) => {
      setPublishing((p) => ({ ...p, [item.id]: true }));
      try {
        const res = await fetch(`/api/pipelines/${pipelineId}/items/${item.id}/concretize`, { method: 'POST' });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Brouillon recréé');
      } catch (err) {
        toast.error(`Recréation échouée : ${(err as Error).message.slice(0, 120)}`);
      } finally {
        setPublishing((p) => ({ ...p, [item.id]: false }));
        onChanged?.();
      }
    },
    [pipelineId, onChanged],
  );

  const isDone = useCallback(
    (item: Act4Item) => DONE_STATUSES.includes(pubOf(item.id)?.post?.status ?? ''),
    [pubOf],
  );
  const publishableNow = items.filter(
    (it) => it.postId && !isDone(it) && !concretizing[it.id] && pubOf(it.id)?.destination?.mode === 'AUTO',
  );
  const schedulableNow = items.filter((it) => it.postId && !isDone(it) && !concretizing[it.id]);

  const publishAll = useCallback(async () => {
    if (publishableNow.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.all(publishableNow.map((it) => publishOne(it, { silent: true })));
      const ok = results.filter((r) => r === 'published').length;
      const manual = results.filter((r) => r === 'manual').length;
      const failed = results.filter((r) => r === 'error').length;
      const skipped = schedulableNow.length - publishableNow.length;
      const parts = [`${ok} publié${ok > 1 ? 's' : ''}`];
      if (manual) parts.push(`${manual} en partage manuel`);
      if (failed) parts.push(`${failed} en échec`);
      if (skipped) parts.push(`${skipped} sans compte connecté (non envoyés)`);
      (failed ? toast.error : toast.success)(parts.join(' · '), { duration: 8000 });
    } finally {
      setBulkBusy(false);
    }
  }, [publishableNow, schedulableNow.length, publishOne]);

  const scheduleAll = useCallback(async () => {
    if (schedulableNow.length === 0) return;
    const start = bulkStart ? new Date(bulkStart) : new Date(Date.now() + 60 * 60 * 1000);
    if (Number.isNaN(start.getTime())) {
      toast.error('Date de départ invalide');
      return;
    }
    setBulkBusy(true);
    try {
      // Étalement : un contenu par heure à partir de la date choisie.
      const results = await Promise.all(
        schedulableNow.map((it, i) =>
          scheduleOne(it, new Date(start.getTime() + i * 60 * 60 * 1000), { silent: true }),
        ),
      );
      const ok = results.filter((r) => r === 'scheduled').length;
      const failed = results.length - ok;
      (failed ? toast.error : toast.success)(
        `${ok} contenu${ok > 1 ? 's' : ''} programmé${ok > 1 ? 's' : ''} (1/h à partir du ${start.toLocaleString('fr-CA')})${failed ? ` · ${failed} en échec` : ''}`,
        { duration: 8000 },
      );
      setBulkOpen(false);
    } finally {
      setBulkBusy(false);
    }
  }, [schedulableNow, bulkStart, scheduleOne]);

  const progress = {
    total: items.length,
    done: items.filter((it) => isDone(it)).length,
  };

  const headerBadge =
    items.length === 0 ? (
      <Badge variant="secondary" className="text-[10px]">VIDE</Badge>
    ) : progress.done === progress.total ? (
      <Badge variant="success" className="text-[10px]">TOUT PUBLIÉ / PROGRAMMÉ</Badge>
    ) : (
      <Badge variant="info" className="text-[10px]">{progress.done}/{progress.total} PUBLIÉS · PROGRAMMÉS</Badge>
    );

  return (
    <Card
      className="border-fuchsia-200 bg-fuchsia-50/20"
      data-act="4"
      data-pipeline-id={pipelineId}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Acte 4 · PRODUIRE &amp; PUBLIER</span>
          {headerBadge}
        </CardTitle>
        <Sparkles className="h-5 w-5 text-fuchsia-600" />
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm italic text-slate-500">
            Aucun contenu à produire pour l'instant — validez des contenus dans l'Acte 3.
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
                  <StatusChip pub={pubOf(item.id)} />
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
                        variant="outline"
                        className="h-6 text-[10px]"
                        onClick={() => assist(item, 'prompt')}
                        disabled={isBusy || assisting !== null}
                        title="Directeur artistique IA : scène visuelle charte graphique, sans texte dans l'image"
                      >
                        {assisting === `${item.id}:prompt` ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 h-3 w-3" />
                        )}
                        Générer le prompt (IA)
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
                        variant="outline"
                        className="h-6 text-[10px]"
                        onClick={() => assist(item, 'caption')}
                        disabled={isBusy || assisting !== null}
                        title="Réécrit la caption avec le contexte de marque, l'ADN et la mémoire stratégique"
                      >
                        {assisting === `${item.id}:caption` ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 h-3 w-3" />
                        )}
                        Régénérer par l&apos;IA
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
                {item.postId ? (
                  <Link href={`/studio?postId=${item.postId}&pipelineId=${pipelineId}`} className="block">
                    <Button size="sm" variant="outline" className="w-full text-[10px]">
                      <ExternalLink className="mr-1 h-3 w-3" /> Ouvrir dans le Studio
                    </Button>
                  </Link>
                ) : null}
                <PublishBlock
                  item={item}
                  pub={pubOf(item.id)}
                  busy={isBusy || isConcretizing || !!publishing[item.id]}
                  scheduling={scheduleOpen === item.id}
                  scheduleAt={scheduleAt[item.id] ?? ''}
                  onScheduleAt={(v) => setScheduleAt((p) => ({ ...p, [item.id]: v }))}
                  onOpenSchedule={() => setScheduleOpen(scheduleOpen === item.id ? null : item.id)}
                  onConfirmSchedule={() => {
                    const v = scheduleAt[item.id];
                    const when = v ? new Date(v) : null;
                    if (!when || Number.isNaN(when.getTime())) {
                      toast.error('Choisis une date et une heure');
                      return;
                    }
                    void scheduleOne(item, when);
                  }}
                  onPublish={() => void publishOne(item)}
                  onShare={() => setShareFor(item)}
                  onRecreate={() => void recreateDraft(item)}
                />
              </div>
            </div>
          );
        })}
      </CardContent>

      {items.length > 0 ? (
        <div className="space-y-2 border-t bg-white/60 px-6 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-medium text-slate-600">
              {progress.done}/{progress.total} contenu{progress.total > 1 ? 's' : ''} publié{progress.done > 1 ? 's' : ''} ou programmé{progress.done > 1 ? 's' : ''}
              {publishableNow.length < schedulableNow.length
                ? ` · ${schedulableNow.length - publishableNow.length} sans compte connecté (partage manuel)`
                : ''}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkOpen((v) => !v)}
                disabled={bulkBusy || schedulableNow.length === 0}
              >
                <CalendarClock className="mr-1 h-3 w-3" />
                Tout programmer ({schedulableNow.length})
              </Button>
              <Button
                size="sm"
                variant="brand"
                onClick={publishAll}
                disabled={bulkBusy || publishableNow.length === 0}
                title={
                  publishableNow.length === 0
                    ? 'Aucun contenu avec un compte connecté'
                    : 'Publie maintenant tous les contenus dont le compte est connecté'
                }
              >
                {bulkBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                Tout publier ({publishableNow.length})
              </Button>
            </div>
          </div>
          {bulkOpen ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-white p-2 text-xs">
              <span>Premier départ :</span>
              <input
                type="datetime-local"
                value={bulkStart}
                onChange={(e) => setBulkStart(e.target.value)}
                className="rounded border px-2 py-1 text-xs"
              />
              <span className="text-slate-500">puis un contenu par heure</span>
              <Button size="sm" variant="brand" className="h-7 text-[11px]" onClick={scheduleAll} disabled={bulkBusy}>
                Confirmer
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setBulkOpen(false)}>
                Annuler
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {shareFor?.postId ? (
        <ManualShareDialog
          postId={shareFor.postId}
          open={!!shareFor}
          onClose={() => setShareFor(null)}
          onShared={() => {
            setShareFor(null);
            onChanged?.();
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Statut réel + destination + actions de publication d'une carte
// ---------------------------------------------------------------------------

const DONE_STATUSES = ['PUBLISHED', 'SIMULATED', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PROCESSING', 'UPLOADING'];

function StatusChip({ pub }: { pub?: ItemPublicationView }) {
  const status = pub?.post?.status;
  if (pub?.postId && !pub.post) return <Badge variant="warning" className="text-[9px]">Brouillon introuvable</Badge>;
  if (!status) return <Badge variant="outline" className="text-[9px]">Brouillon en cours</Badge>;
  const m = postStatusMeta(status);
  return <Badge variant={m.variant} className="text-[9px]">{m.label}</Badge>;
}

const LINK_LABEL: Record<string, string> = {
  zernio: 'publication auto (Zernio)',
  native: 'publication auto',
  manual: 'partage manuel',
};

function DestinationLine({ pub }: { pub?: ItemPublicationView }) {
  const d = pub?.destination;
  if (!pub?.postId) return null;
  if (!d) return <p className="text-[10px] text-slate-500">Destination inconnue</p>;
  if (d.mode === 'MANUAL') {
    return (
      <p className="flex items-center gap-1 text-[10px] text-amber-700">
        <AlertTriangle className="h-3 w-3" /> Aucun compte {d.platform ?? ''} connecté — partage manuel
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1 text-[10px] text-slate-600">
      <Link2 className="h-3 w-3" />
      <span className="font-medium">{d.accountName ?? d.handle ?? d.platform}</span>
      <span>· {LINK_LABEL[d.link] ?? d.link}</span>
      {d.simulated ? <Badge variant="warning" className="ml-1 text-[9px]">SIMULATION</Badge> : null}
    </p>
  );
}

function PublishBlock({
  item,
  pub,
  busy,
  scheduling,
  scheduleAt,
  onScheduleAt,
  onOpenSchedule,
  onConfirmSchedule,
  onPublish,
  onShare,
  onRecreate,
}: {
  item: Act4Item;
  pub?: ItemPublicationView;
  busy: boolean;
  scheduling: boolean;
  scheduleAt: string;
  onScheduleAt: (v: string) => void;
  onOpenSchedule: () => void;
  onConfirmSchedule: () => void;
  onPublish: () => void;
  onShare: () => void;
  onRecreate: () => void;
}) {
  const status = pub?.post?.status ?? '';
  const d = pub?.destination;
  if (!item.postId) {
    return (
      <p className="rounded-md border border-dashed p-2 text-[10px] text-slate-500">
        Le brouillon se crée pendant la concrétisation — publication possible juste après.
      </p>
    );
  }
  if (pub && !pub.post) {
    // postId présent mais post absent (supprimé) : jamais un faux « prêt ».
    return (
      <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
        <AlertTriangle className="mr-1 inline h-3 w-3" /> Brouillon introuvable (supprimé).
        <Button size="sm" variant="outline" className="h-6 w-full text-[10px]" onClick={onRecreate} disabled={busy}>
          Recréer le brouillon (régénère texte + visuel)
        </Button>
      </div>
    );
  }
  if (status === 'PUBLISHED' || status === 'SIMULATED') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[10px] text-emerald-800">
        <CheckCircle2 className="mr-1 inline h-3 w-3" />
        {status === 'SIMULATED' ? 'Publié (simulation)' : 'Publié'}
        {pub?.post?.publishedAt ? ` · ${new Date(pub.post.publishedAt).toLocaleString('fr-CA')}` : ''}
        {pub?.post?.externalPostId ? (
          <span className="block truncate text-emerald-700">id {pub.post.externalPostId}</span>
        ) : null}
        <Link href={`/posts/${item.postId}`} className="mt-1 block underline">
          Voir la publication
        </Link>
      </div>
    );
  }
  if (['PUBLISHING', 'PROCESSING', 'UPLOADING', 'QUEUED'].includes(status)) {
    return (
      <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-[10px] text-sky-800">
        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> {postStatusMeta(status).label}…
      </div>
    );
  }
  const scheduledInfo =
    status === 'SCHEDULED' && pub?.post?.scheduledFor ? (
      <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-[10px] text-sky-800">
        <CalendarClock className="mr-1 inline h-3 w-3" />
        Programmé le {new Date(pub.post.scheduledFor).toLocaleString('fr-CA')}
        {pub.post.shareMode === 'MANUAL' ? ' (partage manuel)' : ''}
      </div>
    ) : null;
  const failedInfo =
    status === 'FAILED' || status === 'ACTION_REQUIRED' ? (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-[10px] text-rose-800">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        {postStatusMeta(status).label}
        {pub?.post?.errorMessage ? ` — ${pub.post.errorMessage.slice(0, 120)}` : ''}
      </div>
    ) : null;

  return (
    <div className="space-y-1.5 border-t pt-2">
      <DestinationLine pub={pub} />
      {scheduledInfo}
      {failedInfo}
      <div className="flex gap-1">
        <Button size="sm" variant="outline" className="h-7 flex-1 text-[10px]" onClick={onOpenSchedule} disabled={busy}>
          <CalendarClock className="mr-1 h-3 w-3" /> {status === 'SCHEDULED' ? 'Reprogrammer' : 'Programmer'}
        </Button>
        {d?.mode === 'AUTO' ? (
          <Button size="sm" variant="brand" className="h-7 flex-1 text-[10px]" onClick={onPublish} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
            {status === 'FAILED' ? 'Republier' : 'Publier'}
          </Button>
        ) : (
          <Button size="sm" variant="brand" className="h-7 flex-1 text-[10px]" onClick={onShare} disabled={busy}>
            <Share2 className="mr-1 h-3 w-3" /> Partager
          </Button>
        )}
      </div>
      {d?.mode === 'MANUAL' ? (
        <Link href="/social-accounts/connect" className="block text-[10px] text-sky-700 underline">
          Connecter un compte {d.platform ?? ''} pour publier automatiquement
        </Link>
      ) : null}
      {scheduling ? (
        <div className="space-y-1 rounded-md border bg-slate-50 p-2">
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => onScheduleAt(e.target.value)}
            className="w-full rounded border px-2 py-1 text-[11px]"
          />
          <Button size="sm" variant="brand" className="h-6 w-full text-[10px]" onClick={onConfirmSchedule} disabled={busy}>
            Confirmer
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default Act4Concretization;
