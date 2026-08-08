'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/client-api-error';
import {
  CheckCircle2,
  Loader2,
  Calendar,
  Send,
  Share2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ManualShareDialog } from '@/components/share/ManualShareDialog';
import { publishPostInput, schedulePostInput } from '@/lib/contracts';

export interface Act5Item {
  id: string;
  title?: string | null;
  platform?: string | null;
  postId?: string | null;
  brandId?: string | null;
  /** Aperçu de publication : visuel(s) + caption concrétisés (Acte 4). */
  caption?: string | null;
  imageUrls?: string[] | null;
  hashtags?: string[] | null;
  brandName?: string | null;
  brandPrimaryColor?: string | null;
}

/** Extrait visuel + caption depuis metadata.concretization d'un item de run. */
function extractPreview(it: {
  caption?: string | null;
  metadata?: Record<string, unknown> | null;
}): { caption: string | null; imageUrls: string[] } {
  const conc = ((it.metadata as Record<string, unknown> | null)?.concretization ?? {}) as {
    caption?: string;
    imageUrls?: string[];
    variants?: Array<{ url?: string }>;
  };
  const imageUrls =
    conc.imageUrls && conc.imageUrls.length > 0
      ? conc.imageUrls
      : (conc.variants ?? []).map((v) => v?.url ?? '').filter(Boolean);
  return { caption: it.caption ?? conc.caption ?? null, imageUrls };
}

export interface Act5ActionProps {
  pipelineId: string;
  /**
   * The specific item to act on. Optional when the component is rendered
   * inside a multi-item shell (e.g. PipelineRunner) — in that case the run's
   * EXECUTED items are auto-derived from `run.strategy.items`.
   */
  item?: Act5Item;
  /** Optional run-shaped fallback (when no explicit `item` is provided). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run?: any;
  /** Optional: list of platforms the org has a connected SocialAccount for. */
  connectedPlatforms?: string[];
  onChanged?: () => void;
  // Permissive: PipelineRunner spreads a shared bag of helpers into every Act.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}

type Outcome =
  | { kind: 'none' }
  | { kind: 'shared'; at: string }
  | { kind: 'scheduled'; at: string }
  | { kind: 'published'; at: string };

function formatLocalDatetime(d: Date) {
  // Returns YYYY-MM-DDTHH:mm in local timezone (for <input type="datetime-local">).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Aperçu de publication : mockup fidèle plateforme (header marque + visuel +
 * caption + hashtags) marqué « SIMULATION » — la publication est simulée tant
 * que ENABLE_REAL_PUBLISHING est désactivé. Montre exactement ce qui partira.
 */
function Act5PublishPreview({ item }: { item: Act5Item }) {
  const image = (item.imageUrls ?? []).find(Boolean) ?? null;
  const platform = (item.platform ?? 'social').toUpperCase();
  const initial = (item.brandName ?? 'S').trim().charAt(0).toUpperCase();
  const accent = item.brandPrimaryColor || '#6366f1';
  const caption = item.caption ?? '';
  const hashtags = (item.hashtags ?? []).slice(0, 5);

  return (
    <div className="relative overflow-hidden rounded-lg border bg-white shadow-sm">
      <span className="absolute right-2 top-2 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
        Simulation
      </span>
      {/* Header façon réseau social */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: accent }}
        >
          {initial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-800">
            {item.brandName ?? 'Votre marque'}
          </p>
          <p className="text-[10px] text-slate-400">{platform}</p>
        </div>
      </div>
      {/* Visuel */}
      <div className="aspect-square w-full bg-slate-100">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={item.title ?? 'visuel'} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-slate-400">
            Visuel en cours de génération…
          </div>
        )}
      </div>
      {/* Caption + hashtags */}
      <div className="space-y-1 p-3">
        <p className="line-clamp-4 whitespace-pre-wrap text-[11px] text-slate-700">
          {caption || <span className="italic text-slate-400">Caption générée à l&apos;Acte 4.</span>}
        </p>
        {hashtags.length > 0 ? (
          <p className="text-[10px] font-medium text-sky-600">
            {hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Shell multi-items de l'Acte 5 : en-tête d'actions groupées (« Tout
 * programmer », « Tout publier ») + une carte par item prêt. Composant séparé
 * pour héberger l'état des actions groupées (hooks).
 */
function Act5MultiShell({
  pipelineId,
  run,
  connectedPlatforms,
  onChanged,
}: {
  pipelineId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: any;
  connectedPlatforms?: string[];
  onChanged?: () => void;
}) {
  const [bulkBusy, setBulkBusy] = useState<'schedule' | 'publish' | null>(null);

  const allItems =
    ((run.strategy?.items as Array<{
      id: string;
      title?: string | null;
      platform?: string | null;
      postId?: string | null;
      hashtags?: string[] | null;
      caption?: string | null;
      metadata?: Record<string, unknown> | null;
    }>) ?? []) || [];
  const itemStates =
    (run.itemStates as Record<string, { status?: string; postId?: string }>) ?? {};
  const ready = allItems.filter((it) => {
    const s = itemStates[it.id]?.status ?? 'PROPOSED';
    return s === 'EXECUTED' || s === 'APPROVED' || s === 'EDITED';
  });

  const connected = new Set((connectedPlatforms ?? []).map((p) => p.toLowerCase()));

  const buildItem = useCallback(
    (it: (typeof allItems)[number]): Act5Item => {
      const { caption, imageUrls } = extractPreview(it);
      return {
        id: it.id,
        title: it.title,
        platform: it.platform,
        postId: itemStates[it.id]?.postId ?? it.postId ?? null,
        brandId: run.brand?.id ?? null,
        caption,
        imageUrls,
        hashtags: it.hashtags ?? null,
        brandName: run.brand?.name ?? null,
        brandPrimaryColor: run.brand?.profile?.primaryColor ?? null,
      };
    },
    [itemStates, run.brand],
  );

  // Programme tous les items prêts, étalés d'une heure chacun à partir de +1h.
  const scheduleAll = useCallback(async () => {
    const targets = ready.filter((it) => itemStates[it.id]?.postId ?? it.postId);
    if (targets.length === 0) return;
    setBulkBusy('schedule');
    try {
      const base = Date.now() + 60 * 60 * 1000;
      const results = await Promise.allSettled(
        targets.map((it, i) => {
          const postId = itemStates[it.id]?.postId ?? it.postId!;
          return fetch(`/api/posts/${postId}/schedule`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              schedulePostInput.parse({
                scheduledFor: new Date(base + i * 60 * 60 * 1000).toISOString(),
                platform: it.platform ?? undefined,
              }),
            ),
          }).then((r) => {
            if (!r.ok) throw new Error(it.title ?? it.id);
          });
        }),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (ok > 0) toast.success(`${ok} publication(s) programmée(s) — étalées sur ${ok} h`);
      if (results.length - ok > 0) toast.error(`${results.length - ok} non programmée(s)`);
      onChanged?.();
    } finally {
      setBulkBusy(null);
    }
  }, [ready, itemStates, onChanged]);

  // Publie tous les items prêts dont la plateforme est connectée (les autres
  // resteraient en partage manuel — on ne les force pas).
  const publishAll = useCallback(async () => {
    const targets = ready.filter(
      (it) =>
        (itemStates[it.id]?.postId ?? it.postId) &&
        it.platform &&
        connected.has(it.platform.toLowerCase()),
    );
    if (targets.length === 0) {
      toast.info('Aucune plateforme connectée pour publication directe — utilisez « Programmer ».');
      return;
    }
    setBulkBusy('publish');
    try {
      const results = await Promise.allSettled(
        targets.map((it) => {
          const postId = itemStates[it.id]?.postId ?? it.postId!;
          return fetch(`/api/posts/${postId}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(publishPostInput.parse({ platform: it.platform ?? undefined })),
          }).then((r) => {
            if (!r.ok) throw new Error(it.title ?? it.id);
          });
        }),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (ok > 0) toast.success(`${ok} publication(s) envoyée(s)`);
      if (results.length - ok > 0) toast.error(`${results.length - ok} échec(s)`);
      onChanged?.();
    } finally {
      setBulkBusy(null);
    }
  }, [ready, itemStates, connected, onChanged]);

  if (ready.length === 0) {
    return (
      <Card className="border-amber-200 bg-amber-50/20" data-act="5" data-pipeline-id={pipelineId}>
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span>Acte 5 · ACTION</span>
            <Badge variant="secondary" className="text-[10px]">VIDE</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm italic text-slate-500">
          Aucun item prêt à publier. Concrétisez des items dans l&apos;Acte 4.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-act="5" data-pipeline-id={pipelineId}>
      {/* En-tête d'actions groupées */}
      <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-slate-700">
          {ready.length} publication{ready.length > 1 ? 's' : ''} prête{ready.length > 1 ? 's' : ''}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={scheduleAll} disabled={bulkBusy !== null}>
            {bulkBusy === 'schedule' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Calendar className="mr-1 h-3 w-3" />
            )}
            Tout programmer
          </Button>
          <Button size="sm" variant="brand" onClick={publishAll} disabled={bulkBusy !== null}>
            {bulkBusy === 'publish' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1 h-3 w-3" />
            )}
            Tout publier
          </Button>
        </div>
      </div>

      {ready.map((it) => (
        <Act5Action
          key={it.id}
          pipelineId={pipelineId}
          item={buildItem(it)}
          connectedPlatforms={connectedPlatforms}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

/**
 * Acte 5 — Action : pour un item "prêt", on choisit Partager / Programmer / Publier.
 * Une fois l'action choisie, la carte collapse en un statut.
 */
export function Act5Action(props: Act5ActionProps) {
  const { pipelineId, connectedPlatforms, onChanged, run } = props;

  // Multi-item mode: when no explicit `item` is passed, delegate to a shell
  // component (it owns the bulk-action hooks — can't call hooks after this
  // component's early return).
  if (!props.item && run) {
    return (
      <Act5MultiShell
        pipelineId={pipelineId}
        run={run}
        connectedPlatforms={connectedPlatforms}
        onChanged={onChanged}
      />
    );
  }

  const item = props.item as Act5Item;

  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  const [shareOpen, setShareOpen] = useState(false);
  const [schedulingOpen, setSchedulingOpen] = useState(false);
  // IMPORTANT: do NOT seed this from Date.now() in the useState initializer.
  // That runs during SSR and again during client hydration at a different
  // instant, so the <input value> differs between server and client → React 19
  // throws a hydration error ("a client-side exception"). Start empty and fill
  // it in a mount-only effect so server and client first-render identically.
  const [scheduleAt, setScheduleAt] = useState<string>('');
  useEffect(() => {
    setScheduleAt((prev) =>
      prev ? prev : formatLocalDatetime(new Date(Date.now() + 60 * 60 * 1000)),
    );
  }, []);
  const [optimalLabel, setOptimalLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState<'schedule' | 'publish' | null>(null);

  const platform = (item.platform ?? '').toLowerCase();
  const canPublish =
    !!item.postId &&
    !!platform &&
    (connectedPlatforms ?? []).map((p) => p.toLowerCase()).includes(platform);

  // Suggest optimal time when scheduling opens.
  useEffect(() => {
    if (!schedulingOpen) return;
    if (!platform) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/intelligence/optimal-times', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform,
            brandId: item.brandId ?? undefined,
            count: 1,
          }),
        });
        if (!res.ok) return;
        const j = (await res.json()) as {
          data?: { slots?: Array<{ at?: string; iso?: string; label?: string }> };
        };
        const slot = j.data?.slots?.[0];
        if (cancelled || !slot) return;
        const iso = slot.at ?? slot.iso;
        if (iso) {
          const d = new Date(iso);
          if (!Number.isNaN(d.getTime())) {
            setScheduleAt(formatLocalDatetime(d));
            setOptimalLabel(slot.label ?? d.toLocaleString());
          }
        }
      } catch {
        /* silent — optional hint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schedulingOpen, platform, item.brandId]);

  // === ACTIONS ===
  const handleSchedule = useCallback(async () => {
    if (!item.postId) {
      toast.error('Post introuvable — la concrétisation a-t-elle bien généré un post ?');
      return;
    }
    setBusy('schedule');
    try {
      const at = new Date(scheduleAt);
      if (Number.isNaN(at.getTime())) {
        toast.error('Date invalide');
        return;
      }
      const res = await fetch(`/api/posts/${item.postId}/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          schedulePostInput.parse({
            scheduledFor: at.toISOString(),
            platform: item.platform,
          }),
        ),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = (await res.json().catch(() => null)) as { data?: { mode?: string } } | null;
      const label = at.toLocaleString();
      if (json?.data?.mode === 'MANUAL') {
        toast.success(`Programmé pour ${label} — en partage manuel`, {
          description: `Aucun compte ${item.platform ?? ''} connecté : au créneau, l'action apparaîtra dans la File de production.`,
        });
      } else {
        toast.success(`Programmé pour ${label} — publication automatique`);
      }
      setOutcome({ kind: 'scheduled', at: label });
      setSchedulingOpen(false);
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 100));
    } finally {
      setBusy(null);
    }
  }, [item.postId, item.platform, scheduleAt, onChanged]);

  const handlePublish = useCallback(async () => {
    if (!item.postId) {
      toast.error('Post introuvable');
      return;
    }
    setBusy('publish');
    try {
      const res = await fetch(`/api/posts/${item.postId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(publishPostInput.parse({ platform: item.platform })),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = (await res.json().catch(() => null)) as
        | { data?: { mode?: string; message?: string } }
        | null;
      // Aucun compte connecté : la route renvoie un partage manuel, pas une
      // publication — on l'affiche honnêtement au lieu d'un faux « Publié ».
      if (json?.data?.mode === 'MANUAL') {
        toast.info(
          json.data.message ??
            `Aucun compte ${item.platform ?? ''} connecté — publication manuelle requise.`,
        );
        return;
      }
      const label = new Date().toLocaleString();
      toast.success('Publié ✓');
      setOutcome({ kind: 'published', at: label });
      onChanged?.();
    } catch (err) {
      toast.error(`Publication échouée: ${(err as Error).message.slice(0, 100)}`);
    } finally {
      setBusy(null);
    }
  }, [item.postId, item.platform, onChanged]);

  // === COLLAPSED STATE ===
  if (outcome.kind !== 'none') {
    const label =
      outcome.kind === 'shared'
        ? `Partagé · ${outcome.at}`
        : outcome.kind === 'scheduled'
          ? `Programmé le ${outcome.at}`
          : `Publié · ${outcome.at}`;
    return (
      <Card
        className="border-emerald-200 bg-emerald-50/40"
        data-act="5"
        data-pipeline-id={pipelineId}
        data-item-id={item.id}
      >
        <CardContent className="flex items-center justify-between gap-2 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">{item.title ?? 'Item'} ✓ {label}</span>
          </div>
          <Badge variant="success" className="text-[10px]">
            ACTE 5
          </Badge>
        </CardContent>
      </Card>
    );
  }

  // === ACTIVE STATE ===
  return (
    <Card
      className="border-amber-200 bg-amber-50/30"
      data-act="5"
      data-pipeline-id={pipelineId}
      data-item-id={item.id}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span>Acte 5 · ACTION</span>
          <Badge variant="warning" className="text-[10px]">À PUBLIER</Badge>
          {item.platform ? (
            <Badge variant="info" className="text-[10px]">
              {item.platform}
            </Badge>
          ) : null}
        </CardTitle>
        <span className="line-clamp-1 max-w-[40%] text-xs text-slate-500">
          {item.title}
        </span>
      </CardHeader>

      <CardContent className="space-y-3 pt-3">
        {/* Aperçu réel de la publication + simulation. Le visuel et la caption
            viennent de la concrétisation (Acte 4). */}
        <Act5PublishPreview item={item} />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {/* === Share manually === */}
          <Button
            variant="outline"
            className="h-auto flex-col gap-1 py-3"
            onClick={() => setShareOpen(true)}
            disabled={!item.postId}
          >
            <Share2 className="h-5 w-5 text-orange-600" />
            <span className="text-xs font-medium">Partager maintenant</span>
            <span className="text-[10px] text-slate-500">Manuel — copier &amp; coller</span>
          </Button>

          {/* === Schedule === */}
          <Button
            variant="outline"
            className="h-auto flex-col gap-1 py-3"
            onClick={() => setSchedulingOpen((v) => !v)}
            disabled={!item.postId}
          >
            <Calendar className="h-5 w-5 text-sky-600" />
            <span className="text-xs font-medium">Programmer</span>
            <span className="text-[10px] text-slate-500">Date &amp; heure</span>
          </Button>

          {/* === Publish now === */}
          {canPublish ? (
            <Button
              variant="brand"
              className="h-auto flex-col gap-1 py-3"
              onClick={handlePublish}
              disabled={busy === 'publish'}
            >
              {busy === 'publish' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              <span className="text-xs font-medium">Publier maintenant</span>
              <span className="text-[10px] opacity-80">API directe</span>
            </Button>
          ) : (
            /* Jamais de bouton mort : sans compte connecté, l'action utile
               est d'aller le connecter. */
            <Button
              variant="outline"
              className="h-auto flex-col gap-1 border-dashed py-3"
              onClick={() => {
                window.location.href = '/social-accounts';
              }}
            >
              <Send className="h-5 w-5 text-slate-400" />
              <span className="text-xs font-medium">
                Connecter {item.platform ?? 'un compte'}
              </span>
              <span className="text-[10px] text-slate-500">
                puis publication directe
              </span>
            </Button>
          )}
        </div>

        {schedulingOpen ? (
          <div className="rounded-md border border-sky-200 bg-white p-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Date &amp; heure de publication
            </label>
            <Input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="text-xs"
            />
            {optimalLabel ? (
              <p className="mt-1 text-[10px] text-sky-700">
                Heure optimale: <span className="font-mono">{optimalLabel}</span>
              </p>
            ) : null}
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSchedulingOpen(false)}
              >
                Annuler
              </Button>
              <Button
                size="sm"
                variant="brand"
                onClick={handleSchedule}
                disabled={busy === 'schedule'}
              >
                {busy === 'schedule' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Calendar className="mr-1 h-3 w-3" />
                )}
                Confirmer la programmation
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      {item.postId ? (
        <ManualShareDialog
          postId={item.postId}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onShared={() => {
            const label = new Date().toLocaleString();
            setOutcome({ kind: 'shared', at: label });
            onChanged?.();
          }}
        />
      ) : null}
    </Card>
  );
}

export default Act5Action;
