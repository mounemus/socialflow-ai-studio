'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, Archive, Calendar as CalendarIcon, CalendarOff, Check, ExternalLink, Image as ImageIcon,
  ListTodo, Loader2, RefreshCw, Send, Trash2, Undo2, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PRODUCTION_COLUMNS, postStatusMeta, type ProductionColumnId } from '@/lib/post-status';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * File de production (Refonte Phase B) — le cycle de vie du Post rendu
 * visible. Fusionne Publications + Validations : valider est une colonne,
 * pas une page.
 *
 * Transitions par glisser-déposer ET par boutons (jamais de geste sans
 * alternative visible). Chaque action appelle les routes existantes
 * (approvals / posts PATCH) — aucune logique métier dupliquée ici.
 */

interface BoardCard {
  id: string;
  title: string;
  excerpt: string;
  status: string;
  format: string;
  updatedAt: string;
  brand: { id: string; name: string } | null;
  mediaCount: number;
  score: number | null;
  scoreVerdict: string | null;
  nextScheduleAt: string | null;
  pendingApprovalId: string | null;
  thumbnailUrl: string | null;
}

// Colonnes et libellés viennent de la source unique des statuts (voir
// src/lib/post-status.ts) — Production, Calendrier et vue détail parlent le
// même langage.
type ColumnId = ProductionColumnId;

const COLUMNS = PRODUCTION_COLUMNS;

/** Statuts qui exigent une action humaine — bandeau dédié, pas une colonne. */
const ATTENTION_STATUSES = ['FAILED', 'ACTION_REQUIRED', 'MANUAL_SHARE_REQUIRED'];

/** Transitions autorisées par glisser-déposer : from → to. */
const DND_TRANSITIONS: Record<string, ColumnId[]> = {
  idea: ['draft'],
  draft: ['review'],
  review: ['approved', 'draft'],
  approved: ['draft'],
};

function columnOf(status: string): ColumnId | null {
  return COLUMNS.find((c) => c.statuses.includes(status))?.id ?? null;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone =
    score >= 70 ? 'bg-emerald-100 text-emerald-800'
    : score >= 40 ? 'bg-amber-100 text-amber-800'
    : 'bg-rose-100 text-rose-800';
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums', tone)}
      title="Score qualité (6 dimensions, évalué avant publication)"
    >
      {score}
    </span>
  );
}

export function ProductionBoardClient() {
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragCard, setDragCard] = useState<{ id: string; from: ColumnId } | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnId | null>(null);
  // Colonnes vides dépliées manuellement (par défaut, une colonne vide se
  // replie en rail étroit pour rendre la largeur au contenu).
  const [expandedEmpty, setExpandedEmpty] = useState<Set<ColumnId>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/production/board', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Chargement impossible (${res.status})`);
      const { data } = await res.json();
      setCards(data.cards ?? []);
    } catch (err) {
      toast.error((err as Error).message);
      setCards([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling 30 s (onglet visible) : les statuts QUEUED→PUBLISHING→PUBLISHED
  // sont changés par le cron côté serveur — sans polling, ce travail était
  // invisible tant qu'on ne cliquait pas « Actualiser ».
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  // ---- actions (routes existantes — pas de logique métier dupliquée) ----
  const patchStatus = useCallback(async (id: string, status: string) => {
    const res = await fetch(`/api/posts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(await res.text().then((t) => t.slice(0, 120)));
  }, []);

  const runAction = useCallback(
    async (card: BoardCard, action: 'toDraft' | 'sendReview' | 'approve' | 'reject' | 'unschedule' | 'archive') => {
      setBusyId(card.id);
      try {
        if (action === 'toDraft') {
          await patchStatus(card.id, 'DRAFT');
          toast.success('Repassé en brouillon');
        } else if (action === 'unschedule') {
          const res = await fetch(`/api/posts/${card.id}/unschedule`, { method: 'POST' });
          if (!res.ok) throw new Error(await res.text().then((t) => t.slice(0, 120)));
          toast.success('Déprogrammé — retour dans « Validés »');
        } else if (action === 'archive') {
          await patchStatus(card.id, 'ARCHIVED');
          toast.success('Archivé');
        } else if (action === 'sendReview') {
          const res = await fetch('/api/approvals', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ postId: card.id }),
          });
          if (!res.ok) throw new Error('Envoi en validation impossible');
          toast.success('Envoyé en validation');
        } else if (action === 'approve') {
          if (card.pendingApprovalId) {
            const res = await fetch(`/api/approvals/${card.pendingApprovalId}/approve`, { method: 'POST' });
            if (!res.ok) throw new Error('Approbation impossible');
          } else {
            await patchStatus(card.id, 'APPROVED');
          }
          toast.success('Approuvé');
        } else if (action === 'reject') {
          if (card.pendingApprovalId) {
            const res = await fetch(`/api/approvals/${card.pendingApprovalId}/reject`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ feedback: 'Renvoyé en brouillon depuis la File de production.' }),
            });
            if (!res.ok) throw new Error('Rejet impossible');
          } else {
            await patchStatus(card.id, 'DRAFT');
          }
          toast.success('Renvoyé en brouillon');
        }
        await load();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 120));
      } finally {
        setBusyId(null);
      }
    },
    [load, patchStatus],
  );

  // « Planifier » planifie VRAIMENT : sélecteur de date inline + POST schedule
  // (la route résout le compte social depuis la plateforme du post). Avant,
  // le bouton était un simple lien vers /calendar où il fallait retrouver son
  // post à la main.
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const confirmSchedule = useCallback(
    async (card: BoardCard) => {
      if (!scheduleAt) return toast.error('Choisissez une date et une heure.');
      setBusyId(card.id);
      try {
        const res = await fetch(`/api/posts/${card.id}/schedule`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scheduledFor: new Date(scheduleAt).toISOString() }),
        });
        if (!res.ok) throw new Error(await res.text().then((t) => t.slice(0, 120)));
        const json = (await res.json().catch(() => ({}))) as { data?: { mode?: string } };
        toast.success(
          json.data?.mode === 'MANUAL'
            ? 'Créneau posé — partage manuel (aucun compte connecté sur cette plateforme).'
            : 'Publication programmée.',
        );
        setSchedulingId(null);
        setScheduleAt('');
        await load();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 120));
      } finally {
        setBusyId(null);
      }
    },
    [scheduleAt, load],
  );

  // « Publier » publie VRAIMENT depuis la file (même route que l'Acte 4 du
  // pipeline : la destination est résolue côté serveur, jamais de faux succès).
  const publishNow = useCallback(
    async (card: BoardCard) => {
      if (!window.confirm('Publier maintenant sur le compte connecté ?')) return;
      setBusyId(card.id);
      try {
        const res = await fetch(`/api/posts/${card.id}/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: { mode?: string; message?: string; result?: { success?: boolean; simulated?: boolean; error?: string } };
          message?: string;
        };
        if (!res.ok) throw new Error(json.message ?? `Erreur ${res.status}`);
        const d = json.data ?? {};
        if (d.mode === 'MANUAL') toast.info(d.message ?? 'Aucun compte connecté — partage manuel.');
        else if (d.result?.success === false) throw new Error(d.result.error ?? 'Le réseau a refusé la publication');
        else toast.success(d.result?.simulated ? 'Publié (simulation — mode réel désactivé)' : 'Publié ✓');
        await load();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 140));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  /** Suppression définitive — retire la carte localement, pas de rechargement complet. */
  const deleteCard = useCallback(async (card: BoardCard) => {
    if (!window.confirm('Supprimer définitivement cette publication ?')) return;
    setBusyId(card.id);
    try {
      const res = await fetch(`/api/posts/${card.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text().then((t) => t.slice(0, 120)));
      setCards((prev) => (prev ? prev.filter((c) => c.id !== card.id) : prev));
      toast.success('Publication supprimée');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusyId(null);
    }
  }, []);

  const onDropInColumn = useCallback(
    async (to: ColumnId) => {
      if (!dragCard) return;
      const allowed = DND_TRANSITIONS[dragCard.from]?.includes(to);
      setDropTarget(null);
      const card = cards?.find((c) => c.id === dragCard.id);
      setDragCard(null);
      if (!allowed || !card) return;
      if (to === 'draft') await runAction(card, dragCard.from === 'review' ? 'reject' : 'toDraft');
      else if (to === 'review') await runAction(card, 'sendReview');
      else if (to === 'approved') await runAction(card, 'approve');
    },
    [dragCard, cards, runAction],
  );

  const byColumn = useMemo(() => {
    const map = new Map<ColumnId, BoardCard[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const c of cards ?? []) {
      const col = columnOf(c.status);
      if (col) map.get(col)!.push(c);
    }
    return map;
  }, [cards]);

  const attention = useMemo(
    () => (cards ?? []).filter((c) => ATTENTION_STATUSES.includes(c.status)),
    [cards],
  );

  if (cards === null) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la File…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Bandeau incidents : ce qui exige une action, jamais enterré ---- */}
      {attention.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> À traiter ({attention.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {attention.map((c) => (
              <Link
                key={c.id}
                href={`/posts/${c.id}`}
                className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-xs hover:border-amber-400"
              >
                <span className="max-w-[220px] truncate font-medium">{c.title}</span>
                <Badge variant={postStatusMeta(c.status).variant} className="text-[10px]">
                  {postStatusMeta(c.status).label}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- Le kanban ----
          Fondu sur le bord droit : signale qu'il reste des colonnes à
          découvrir au défilement (la colonne « Programmés » était coupée
          net sans indication). */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-white to-transparent"
        />
      <div className="overflow-x-auto pb-2" style={{ overscrollBehaviorX: 'contain' }}>
        <div className="flex gap-3">
          {COLUMNS.map((col) => {
            const list = byColumn.get(col.id) ?? [];
            const droppable = dragCard ? DND_TRANSITIONS[dragCard.from]?.includes(col.id) : false;

            // Colonne vide → rail replié : sur un écran standard, deux
            // colonnes vides à pleine largeur poussaient « Programmés » et
            // « Publiés » hors écran. Elle se déplie automatiquement quand
            // elle devient une cible de dépôt pendant un glisser.
            const collapsed = list.length === 0 && !droppable && !expandedEmpty.has(col.id);
            if (collapsed) {
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={() =>
                    setExpandedEmpty((prev) => {
                      const next = new Set(prev);
                      next.add(col.id);
                      return next;
                    })
                  }
                  title={`${col.label} — vide. Cliquer pour déplier.`}
                  className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-xl border bg-slate-50/60 py-3 text-muted-foreground transition-colors hover:bg-slate-100"
                >
                  <span className="text-xs font-bold tabular-nums">0</span>
                  <span className="text-xs font-semibold [writing-mode:vertical-rl]">{col.label}</span>
                </button>
              );
            }

            return (
              <div
                key={col.id}
                className={cn(
                  'flex min-w-[250px] max-w-[340px] flex-1 flex-col rounded-xl border bg-slate-50/60 transition-colors',
                  droppable && dropTarget === col.id && 'border-violet-400 bg-violet-50',
                  droppable && dropTarget !== col.id && 'border-dashed border-violet-300',
                )}
                onDragOver={(e) => {
                  if (droppable) {
                    e.preventDefault();
                    setDropTarget(col.id);
                  }
                }}
                onDragLeave={() => setDropTarget((t) => (t === col.id ? null : t))}
                onDrop={(e) => {
                  e.preventDefault();
                  void onDropInColumn(col.id);
                }}
              >
                <div className="flex items-center justify-between px-3 pb-1 pt-3">
                  <div>
                    <span className="text-sm font-semibold">{col.label}</span>
                    <span className="ml-2 text-xs tabular-nums text-muted-foreground">{list.length}</span>
                  </div>
                </div>
                <p className="px-3 text-[11px] text-muted-foreground">{col.hint}</p>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {list.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs italic text-muted-foreground">Vide</p>
                  ) : (
                    list.map((c) => {
                      const isBusy = busyId === c.id;
                      const from = columnOf(c.status);
                      const draggable = !!from && !!DND_TRANSITIONS[from]?.length && !isBusy;
                      return (
                        <div
                          key={c.id}
                          draggable={draggable}
                          onDragStart={() => from && setDragCard({ id: c.id, from })}
                          onDragEnd={() => {
                            setDragCard(null);
                            setDropTarget(null);
                          }}
                          className={cn(
                            'overflow-hidden rounded-lg border bg-white shadow-sm',
                            draggable && 'cursor-grab active:cursor-grabbing',
                            isBusy && 'opacity-60',
                          )}
                        >
                          {/* Le contenu d'abord : miniature du visuel quand
                              elle existe — une carte de production sans son
                              image ne dit rien. */}
                          {c.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.thumbnailUrl}
                              alt=""
                              className="h-24 w-full border-b object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}
                          <div className="p-2.5">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <Link
                              href={`/posts/${c.id}`}
                              className="line-clamp-2 text-[13px] font-medium leading-snug hover:underline"
                            >
                              {c.title}
                            </Link>
                            <ScoreBadge score={c.score} />
                          </div>
                          {c.excerpt && !c.title.startsWith(c.excerpt.slice(0, 24)) ? (
                            <p className="mb-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                              {c.excerpt}
                            </p>
                          ) : null}
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            {c.brand ? (
                              <span className="rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">
                                {c.brand.name}
                              </span>
                            ) : null}
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">{c.format}</span>
                            {c.status === 'SIMULATED' ? (
                              <Badge variant="warning" className="text-[9px]">simulation</Badge>
                            ) : null}
                            {c.mediaCount > 0 ? (
                              <span className="flex items-center gap-0.5">
                                <ImageIcon className="h-3 w-3" /> {c.mediaCount}
                              </span>
                            ) : null}
                            {c.nextScheduleAt ? (
                              <span className="flex items-center gap-0.5">
                                <CalendarIcon className="h-3 w-3" />
                                {new Date(c.nextScheduleAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : null}
                          </div>

                          {/* Actions par étape — alternative visible au glisser-déposer */}
                          <div className="flex flex-wrap gap-1">
                            {col.id === 'idea' ? (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                onClick={() => runAction(c, 'toDraft')}>
                                <ListTodo className="mr-1 h-3 w-3" /> En brouillon
                              </Button>
                            ) : null}
                            {col.id === 'draft' ? (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                onClick={() => runAction(c, 'sendReview')}>
                                <Send className="mr-1 h-3 w-3" /> En validation
                              </Button>
                            ) : null}
                            {col.id === 'review' ? (
                              <>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] text-emerald-700" disabled={isBusy}
                                  onClick={() => runAction(c, 'approve')}>
                                  <Check className="mr-1 h-3 w-3" /> Approuver
                                </Button>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] text-rose-700" disabled={isBusy}
                                  onClick={() => runAction(c, 'reject')}>
                                  <X className="mr-1 h-3 w-3" /> Renvoyer
                                </Button>
                              </>
                            ) : null}
                            {col.id === 'approved' ? (
                              schedulingId === c.id ? (
                                <div className="flex w-full flex-wrap items-center gap-1">
                                  <input
                                    type="datetime-local"
                                    className="h-6 rounded border border-input bg-background px-1 text-[11px]"
                                    value={scheduleAt}
                                    onChange={(e) => setScheduleAt(e.target.value)}
                                  />
                                  <Button size="sm" variant="brand" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                    onClick={() => confirmSchedule(c)}>
                                    <Check className="mr-1 h-3 w-3" /> OK
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                                    onClick={() => setSchedulingId(null)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                              <>
                                <Button size="sm" variant="brand" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                  onClick={() => publishNow(c)}>
                                  <Send className="mr-1 h-3 w-3" /> Publier
                                </Button>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                  onClick={() => setSchedulingId(c.id)}>
                                  <CalendarIcon className="mr-1 h-3 w-3" /> Planifier
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                  onClick={() => runAction(c, 'toDraft')}>
                                  <Undo2 className="mr-1 h-3 w-3" /> Brouillon
                                </Button>
                              </>
                              )
                            ) : null}
                            {col.id === 'scheduled' || col.id === 'published' ? (
                              <Link href={`/posts/${c.id}`}>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
                                  <ExternalLink className="mr-1 h-3 w-3" /> Ouvrir
                                </Button>
                              </Link>
                            ) : null}
                            {col.id === 'scheduled' ? (
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                onClick={() => {
                                  if (window.confirm('Déprogrammer ? La publication retournera dans « Validés ».')) {
                                    void runAction(c, 'unschedule');
                                  }
                                }}>
                                <CalendarOff className="mr-1 h-3 w-3" /> Déprogrammer
                              </Button>
                            ) : null}
                            {col.id === 'published' ? (
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={isBusy}
                                onClick={() => runAction(c, 'archive')}>
                                <Archive className="mr-1 h-3 w-3" /> Archiver
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-rose-700" disabled={isBusy}
                              onClick={() => deleteCard(c)}>
                              <Trash2 className="mr-1 h-3 w-3" /> Supprimer
                            </Button>
                          </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Glisse une carte vers une colonne autorisée, ou utilise les boutons — même résultat.
        </p>
        <Button size="sm" variant="ghost" onClick={() => load()}>
          <RefreshCw className="mr-1 h-3 w-3" /> Actualiser
        </Button>
      </div>
    </div>
  );
}
