'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Clock, Lock, Loader2, Building2, User2 } from 'lucide-react';
import type { ApprovalStatus, UserRole } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export type ApprovalItem = {
  id: string;
  status: ApprovalStatus;
  message: string | null;
  decidedAt: string | null;
  createdAt: string;
  requesterName: string | null;
  commentsCount: number;
  post: {
    id: string;
    title: string | null;
    format: string;
    brandName: string | null;
    excerpt: string;
  };
};

type TabKey = 'pending' | 'approved' | 'rejected';

const TABS: { key: TabKey; label: string; statuses: ApprovalStatus[]; icon: typeof Clock }[] = [
  { key: 'pending', label: 'En attente', statuses: ['PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED'], icon: Clock },
  { key: 'approved', label: 'Approuvées', statuses: ['APPROVED'], icon: CheckCircle2 },
  { key: 'rejected', label: 'Rejetées', statuses: ['REJECTED'], icon: XCircle },
];

const APPROVER_ROLES: UserRole[] = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'STRATEGIST'];

function statusBadge(status: ApprovalStatus) {
  switch (status) {
    case 'APPROVED':
      return <Badge variant="success">Approuvée</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">Rejetée</Badge>;
    case 'CHANGES_REQUESTED':
      return <Badge variant="warning">Modifications demandées</Badge>;
    case 'IN_REVIEW':
      return <Badge variant="info">En revue</Badge>;
    default:
      return <Badge variant="warning">En attente</Badge>;
  }
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function ApprovalsClient({
  items: initialItems,
  role,
  canApprove,
}: {
  items: ApprovalItem[];
  role: UserRole;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ApprovalItem[]>(initialItems);
  const [tab, setTab] = useState<TabKey>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const it of items) {
      const t = TABS.find((tb) => tb.statuses.includes(it.status));
      if (t) c[t.key] += 1;
    }
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const def = TABS.find((t) => t.key === tab)!;
    return items.filter((it) => def.statuses.includes(it.status));
  }, [items, tab]);

  async function decide(id: string, action: 'approve' | 'reject', body?: Record<string, unknown>) {
    setBusyId(id);
    const newStatus: ApprovalStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    // Optimistic update.
    const prev = items;
    setItems((cur) =>
      cur.map((it) =>
        it.id === id
          ? {
              ...it,
              status: newStatus,
              decidedAt: new Date().toISOString(),
              message: action === 'reject' ? ((body?.feedback as string) ?? it.message) : it.message,
            }
          : it,
      ),
    );

    try {
      const res = await fetch(`/api/approvals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? 'La demande a échoué.');
      }
      toast.success(action === 'approve' ? 'Demande approuvée.' : 'Demande rejetée.');
      setRejectingId(null);
      setFeedback('');
      // Refresh server data so post status / comments stay in sync.
      startTransition(() => router.refresh());
    } catch (err) {
      setItems(prev); // rollback
      toast.error(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setBusyId(null);
    }
  }

  function submitReject(id: string) {
    const text = feedback.trim();
    if (!text) {
      toast.error('Ajoute un commentaire pour expliquer le rejet.');
      return;
    }
    void decide(id, 'reject', { feedback: text });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validations</h1>
        <p className="text-sm text-muted-foreground">
          Demandes d&apos;approbation envoyées aux clients ou réviseurs.
        </p>
      </div>

      {/* Role gating banner */}
      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border p-4 text-sm',
          canApprove
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-amber-200 bg-amber-50 text-amber-900',
        )}
      >
        {canApprove ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        ) : (
          <Lock className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div>
          <p className="font-medium">
            {canApprove
              ? `Tu peux approuver ou rejeter (rôle ${role}).`
              : `Lecture seule — ton rôle (${role}) ne permet pas d'approuver.`}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            Seuls les rôles {APPROVER_ROLES.join(', ')} peuvent valider une demande. Les autres rôles
            ont un accès en lecture seule.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  active ? 'bg-primary/10 text-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <EmptyState
          icon={
            tab === 'pending' ? (
              <Clock className="h-10 w-10" />
            ) : tab === 'approved' ? (
              <CheckCircle2 className="h-10 w-10" />
            ) : (
              <XCircle className="h-10 w-10" />
            )
          }
          title={
            tab === 'pending'
              ? 'Aucune validation en attente'
              : tab === 'approved'
                ? 'Aucune validation approuvée'
                : 'Aucune validation rejetée'
          }
          description={
            tab === 'pending'
              ? 'Les demandes envoyées aux réviseurs apparaîtront ici.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((it) => {
            const isPending = TABS[0].statuses.includes(it.status);
            const busy = busyId === it.id;
            const rejecting = rejectingId === it.id;
            return (
              <Card key={it.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-start justify-between gap-3 text-base">
                    <span className="leading-snug">
                      {it.post.title || it.post.excerpt.slice(0, 60) || 'Sans titre'}
                    </span>
                    {statusBadge(it.status)}
                  </CardTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {it.post.brandName ?? 'Sans marque'}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {it.post.format}
                    </Badge>
                    {it.requesterName ? (
                      <span className="inline-flex items-center gap-1">
                        <User2 className="h-3.5 w-3.5" />
                        {it.requesterName}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDate(it.createdAt)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {it.post.excerpt ? (
                    <p className="whitespace-pre-line rounded-md bg-muted/50 p-3 text-sm text-foreground">
                      {it.post.excerpt}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Aucun contenu à prévisualiser.</p>
                  )}

                  {it.status === 'REJECTED' && it.message ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <p className="font-medium text-destructive">Retour du réviseur</p>
                      <p className="mt-1 text-foreground">{it.message}</p>
                    </div>
                  ) : null}

                  {it.decidedAt && !isPending ? (
                    <p className="text-xs text-muted-foreground">
                      Décidée le {formatDate(it.decidedAt)}
                    </p>
                  ) : null}

                  {isPending ? (
                    <div className="space-y-3">
                      {rejecting ? (
                        <div className="space-y-2">
                          <Textarea
                            placeholder="Explique pourquoi cette demande est rejetée…"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            disabled={busy}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => submitReject(it.id)}
                              disabled={busy || !feedback.trim()}
                            >
                              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                              Confirmer le rejet
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRejectingId(null);
                                setFeedback('');
                              }}
                              disabled={busy}
                            >
                              Annuler
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {/* Gated approve / reject buttons.
                              When the user can't approve, the buttons are disabled and
                              wrapped in a title-tooltip element ("Permission requise"). */}
                          <GatedAction
                            disabled={!canApprove}
                            tooltip="Permission requise"
                          >
                            <Button
                              size="sm"
                              onClick={() => void decide(it.id, 'approve')}
                              disabled={!canApprove || busy}
                            >
                              {busy ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                              )}
                              Approuver
                            </Button>
                          </GatedAction>
                          <GatedAction disabled={!canApprove} tooltip="Permission requise">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRejectingId(it.id);
                                setFeedback('');
                              }}
                              disabled={!canApprove || busy}
                            >
                              <XCircle className="mr-1.5 h-4 w-4" />
                              Rejeter
                            </Button>
                          </GatedAction>
                          {!canApprove ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Lock className="h-3.5 w-3.5" />
                              Permission requise
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Wraps a (possibly disabled) action so it still shows a native tooltip when
 * disabled — disabled buttons don't fire pointer events, so the title must live
 * on a wrapping element.
 */
function GatedAction({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean;
  tooltip: string;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;
  return (
    <span title={tooltip} className="inline-flex cursor-not-allowed">
      {children}
    </span>
  );
}
