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

export interface Act5Item {
  id: string;
  title?: string | null;
  platform?: string | null;
  postId?: string | null;
  brandId?: string | null;
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
 * Acte 5 — Action : pour un item "prêt", on choisit Partager / Programmer / Publier.
 * Une fois l'action choisie, la carte collapse en un statut.
 */
export function Act5Action(props: Act5ActionProps) {
  const { pipelineId, connectedPlatforms, onChanged, run } = props;

  // Multi-item mode: when no explicit `item` is passed, derive the list of
  // ready/executed items from the run and render one collapsed card per item.
  // This is the shape PipelineRunner uses (single Act5 receives the run).
  if (!props.item && run) {
    const allItems =
      ((run.strategy?.items as Array<{
        id: string;
        title?: string | null;
        platform?: string | null;
        postId?: string | null;
      }>) ?? []) || [];
    const itemStates =
      (run.itemStates as Record<string, { status?: string; postId?: string }>) ?? {};
    const ready = allItems.filter((it) => {
      const s = itemStates[it.id]?.status ?? 'PROPOSED';
      return s === 'EXECUTED' || s === 'APPROVED' || s === 'EDITED';
    });
    if (ready.length === 0) {
      return (
        <Card
          className="border-amber-200 bg-amber-50/20"
          data-act="5"
          data-pipeline-id={pipelineId}
        >
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
        {ready.map((it) => (
          <Act5Action
            key={it.id}
            pipelineId={pipelineId}
            item={{
              id: it.id,
              title: it.title,
              platform: it.platform,
              postId: itemStates[it.id]?.postId ?? it.postId ?? null,
              brandId: run.brand?.id ?? null,
            }}
            connectedPlatforms={connectedPlatforms}
            onChanged={onChanged}
          />
        ))}
      </div>
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
        body: JSON.stringify({
          scheduledFor: at.toISOString(),
          platform: item.platform,
        }),
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
        body: JSON.stringify({ platform: item.platform }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
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
