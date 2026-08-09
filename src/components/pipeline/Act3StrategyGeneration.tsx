'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/client-api-error';
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  RefreshCw,
  Eye,
  Pencil,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { approveStepInput } from '@/lib/contracts';

export type Act3ItemStatus =
  | 'PROPOSED'
  | 'EDITED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED';

export interface Act3Item {
  id: string;
  title?: string | null;
  brief?: string | null;
  description?: string | null;
  kind?: string | null;
  platform?: string | null;
  status?: Act3ItemStatus | string | null;
  order?: number | null;
}

export interface Act3Strategy {
  vision?: string | null;
  pillars?: string[] | null;
  kpis?: Array<{ name: string; target?: string | number }> | string[] | null;
  persona?: string | null;
  items?: Act3Item[];
}

export interface Act3Run {
  step?: string;
  status?: string;
  strategy?: Act3Strategy | null;
  itemStates?: Record<string, { status?: string; rejectedReason?: string } | unknown> | null;
}

export interface Act3StrategyGenerationProps {
  pipelineId: string;
  run?: Act3Run | null;
  onChanged?: () => void;
  // Permissive: PipelineRunner spreads a shared bag of helpers into every Act.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}

type Filter = 'all' | 'approved' | 'pending' | string; // string for kind filter

/**
 * Acte 3 — Génération + validation de la stratégie marketing.
 */
export function Act3StrategyGeneration({
  pipelineId,
  run,
  onChanged,
}: Act3StrategyGenerationProps) {
  const strategy = run?.strategy ?? null;
  const items = strategy?.items ?? [];
  const itemStates = (run?.itemStates ?? {}) as Record<
    string,
    { status?: string; rejectedReason?: string }
  >;

  const [filter, setFilter] = useState<Filter>('all');
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');

  // Pas de polling ici : le rafraîchissement de `run` est assuré par
  // PipelineRunner (5 s, suspendu onglet caché).
  const strategyReady = items.length > 0;

  function effectiveStatus(it: Act3Item): string {
    return (
      (itemStates[it.id]?.status as string | undefined) ??
      (it.status as string | undefined) ??
      'PROPOSED'
    );
  }

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const s = effectiveStatus(it);
      if (filter === 'all') return true;
      if (filter === 'approved') return s === 'APPROVED' || s === 'EDITED';
      if (filter === 'pending') return s === 'PROPOSED';
      return (it.kind ?? '').toLowerCase() === filter;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, itemStates, filter]);

  const kinds = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) if (it.kind) seen.add(it.kind);
    return Array.from(seen);
  }, [items]);

  const approvedCount = useMemo(
    () =>
      items.filter((it) => {
        const s = effectiveStatus(it);
        return s === 'APPROVED' || s === 'EDITED';
      }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, itemStates],
  );

  // === ACTIONS ===
  const approveItem = useCallback(
    async (itemId: string) => {
      setBusyItem(itemId);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${itemId}/approve`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Item approuvé');
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, onChanged],
  );

  const rejectItem = useCallback(
    async (itemId: string) => {
      setBusyItem(itemId);
      try {
        const reason = window.prompt('Raison du rejet ?', '') ?? '';
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${itemId}/reject`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason }),
          },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Item rejeté');
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, onChanged],
  );

  const regenerateItem = useCallback(
    async (itemId: string) => {
      setBusyItem(itemId);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${itemId}/regenerate`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Item régénéré');
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, onChanged],
  );

  const saveEdit = useCallback(
    async (itemId: string) => {
      setBusyItem(itemId);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/items/${itemId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ brief: editDraft }),
          },
        );
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Item modifié');
        setEditing(null);
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 100));
      } finally {
        setBusyItem(null);
      }
    },
    [pipelineId, editDraft, onChanged],
  );

  const approveAll = useCallback(async () => {
    setBulkBusy(true);
    try {
      // Approve each remaining item, then approve the step.
      for (const it of items) {
        const s = effectiveStatus(it);
        if (s === 'PROPOSED') {
          await fetch(
            `/api/pipelines/${pipelineId}/items/${it.id}/approve`,
            { method: 'POST' },
          ).catch(() => null);
        }
      }
      toast.success(`${items.length} items approuvés`);
      onChanged?.();
    } finally {
      setBulkBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, items, itemStates, onChanged]);

  const continueWithApproved = useCallback(async () => {
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(approveStepInput.parse({ stepName: 'VALIDATE_STRATEGY_ITEMS' })),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success("Stratégie validée — passage à l'exécution");
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 100));
    } finally {
      setBulkBusy(false);
    }
  }, [pipelineId, onChanged]);

  // Porte admin VALIDATE_STRATEGY_ITEMS : refuse la stratégie entière —
  // destructif côté serveur (supprime la stratégie + items générés, rewind
  // vers GENERATE_STRATEGY).
  const rejectStrategy = useCallback(async () => {
    if (
      !window.confirm(
        'Refuser et régénérer la stratégie ? La stratégie et ses éléments actuels seront supprimés.',
      )
    )
      return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stepName: 'VALIDATE_STRATEGY_ITEMS',
          feedback: "Régénération demandée par l'admin",
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Stratégie refusée — régénération en cours…');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 100));
    } finally {
      setBulkBusy(false);
    }
  }, [pipelineId, onChanged]);

  const allDone = run?.step === 'EXECUTE_ITEMS' || run?.step === 'DONE';
  const headerBadge = allDone ? (
    <Badge variant="success" className="text-[10px]">DONE</Badge>
  ) : strategyReady && run?.status === 'AWAITING_ADMIN' ? (
    <Badge variant="warning" className="text-[10px]">À VALIDER</Badge>
  ) : (
    <Badge variant="info" className="text-[10px]">RUNNING</Badge>
  );

  const headerIcon = allDone ? (
    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
  ) : (
    <Loader2
      className={
        'h-5 w-5 ' +
        (strategyReady ? 'text-amber-600' : 'animate-spin text-sky-600')
      }
    />
  );

  return (
    <Card
      className={
        allDone
          ? 'border-emerald-200 bg-slate-50 opacity-80'
          : 'border-violet-200 bg-violet-50/20'
      }
      data-act="3"
      data-pipeline-id={pipelineId}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Acte 3 · STRATÉGIE</span>
          {headerBadge}
        </CardTitle>
        {headerIcon}
      </CardHeader>

      <CardContent className="pt-4">
        {!strategyReady ? (
          <div className="space-y-3 py-6 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-violet-600" />
            <p className="text-sm text-slate-600">
              Génération de la stratégie marketing…
            </p>
            <p className="text-xs text-slate-400">
              Vision, piliers, KPIs, persona + plan d'actions concret
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
            {/* === LEFT: stratégie globale === */}
            <div className="space-y-3 rounded-lg border bg-white p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                Stratégie globale
              </h4>
              {strategy?.vision ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    Vision
                  </p>
                  <p className="text-xs text-slate-700">{strategy.vision}</p>
                </div>
              ) : null}
              {strategy?.persona ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    Persona
                  </p>
                  <p className="text-xs text-slate-700">{strategy.persona}</p>
                </div>
              ) : null}
              {strategy?.pillars && strategy.pillars.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    Piliers
                  </p>
                  <ul className="ml-3 list-disc text-xs text-slate-700">
                    {strategy.pillars.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {strategy?.kpis && (strategy.kpis as unknown[]).length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    KPIs
                  </p>
                  <ul className="ml-3 list-disc text-xs text-slate-700">
                    {(strategy.kpis as unknown[]).map((k, i) => {
                      if (typeof k === 'string') return <li key={i}>{k}</li>;
                      const kp = k as { name?: string; target?: string | number };
                      return (
                        <li key={i}>
                          {kp.name}
                          {kp.target ? `: ${kp.target}` : ''}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* === RIGHT: items === */}
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-1">
                {(['all', 'approved', 'pending'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={
                      'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ' +
                      (filter === f
                        ? 'border-violet-500 bg-violet-100 text-violet-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
                    }
                  >
                    {f === 'all' ? 'Tous' : f === 'approved' ? 'Approuvés' : 'À valider'}
                  </button>
                ))}
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k.toLowerCase())}
                    className={
                      'rounded-full border px-2 py-0.5 text-[10px] capitalize transition-colors ' +
                      (filter === k.toLowerCase()
                        ? 'border-violet-500 bg-violet-100 text-violet-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>

              {/* Items scroll list */}
              <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                {filteredItems.length === 0 ? (
                  <p className="text-center text-xs italic text-slate-400">
                    Aucun item correspondant au filtre.
                  </p>
                ) : null}
                {filteredItems.map((it) => {
                  const status = effectiveStatus(it);
                  const isBusy = busyItem === it.id;
                  const isEditing = editing === it.id;
                  const approved = status === 'APPROVED' || status === 'EDITED';
                  const rejected = status === 'REJECTED';
                  return (
                    <div
                      key={it.id}
                      className={
                        'rounded-md border bg-white p-2 ' +
                        (approved
                          ? 'border-emerald-200'
                          : rejected
                            ? 'border-red-200 opacity-60'
                            : 'border-slate-200')
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge
                              variant={
                                approved
                                  ? 'success'
                                  : rejected
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="text-[9px]"
                            >
                              {status}
                            </Badge>
                            {it.kind ? (
                              <Badge variant="outline" className="text-[9px] capitalize">
                                {it.kind}
                              </Badge>
                            ) : null}
                            {it.platform ? (
                              <Badge variant="info" className="text-[9px]">
                                {it.platform}
                              </Badge>
                            ) : null}
                          </div>
                          <h5 className="mt-1 text-xs font-semibold text-slate-800">
                            {it.title ?? 'Sans titre'}
                          </h5>
                          {isEditing ? (
                            <Textarea
                              rows={3}
                              className="mt-1 text-[11px]"
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                            />
                          ) : (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
                              {it.brief ?? it.description ?? ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="brand"
                              className="h-6 text-[10px]"
                              onClick={() => saveEdit(it.id)}
                              disabled={isBusy}
                            >
                              {isBusy ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : null}
                              Enregistrer
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px]"
                              onClick={() => setEditing(null)}
                            >
                              Annuler
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={() => {
                                setEditing(it.id);
                                setEditDraft(it.brief ?? it.description ?? '');
                              }}
                              disabled={isBusy || approved}
                            >
                              <Pencil className="mr-1 h-3 w-3" /> Modifier
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={() => regenerateItem(it.id)}
                              disabled={isBusy}
                            >
                              {isBusy ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="mr-1 h-3 w-3" />
                              )}
                              Régénérer
                            </Button>
                            <Button
                              size="sm"
                              variant="brand"
                              className="h-6 text-[10px]"
                              onClick={() => approveItem(it.id)}
                              disabled={isBusy || approved}
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Approuver
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] text-red-600"
                              onClick={() => rejectItem(it.id)}
                              disabled={isBusy || rejected}
                            >
                              <X className="mr-1 h-3 w-3" /> Rejeter
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px]"
                              onClick={() => toast.info(it.title ?? '')}
                            >
                              <Eye className="mr-1 h-3 w-3" /> Voir détails
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* === FOOTER === */}
      <div className="flex flex-col gap-2 border-t bg-white/60 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-slate-600">
          {approvedCount} / {items.length} items approuvés
        </span>
        <div className="flex gap-2">
          {!allDone ? (
            <>
              {run?.status === 'AWAITING_ADMIN' && run?.step === 'VALIDATE_STRATEGY_ITEMS' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={rejectStrategy}
                  disabled={bulkBusy}
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Régénérer la stratégie
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={approveAll}
                disabled={bulkBusy || items.length === 0}
              >
                {bulkBusy ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                )}
                Approuver tous
              </Button>
              <Button
                variant="brand"
                size="sm"
                onClick={continueWithApproved}
                disabled={bulkBusy || approvedCount === 0}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Continuer avec {approvedCount} item{approvedCount > 1 ? 's' : ''}
              </Button>
            </>
          ) : (
            <span className="text-xs text-emerald-700">Acte 3 validé ✓</span>
          )}
        </div>
      </div>
    </Card>
  );
}

export default Act3StrategyGeneration;
