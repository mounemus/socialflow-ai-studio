'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Loader2,
  Play,
  Pause,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleAlert,
  ArrowLeft,
  Workflow,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// 5-Act narrative components — owned by other builders. These imports are
// declared here so the wiring is in place; if a builder hasn't shipped yet,
// the TypeScript compiler will flag the missing module and the runtime will
// surface a clear error in the dev console.
import { Act1BrandDeclaration } from '@/components/pipeline/Act1BrandDeclaration';
import { Act2BrandEnrichment } from '@/components/pipeline/Act2BrandEnrichment';
import { Act3StrategyGeneration } from '@/components/pipeline/Act3StrategyGeneration';
import { Act4Concretization } from '@/components/pipeline/Act4Concretization';
import { Act5Action } from '@/components/pipeline/Act5Action';
// PreviewRenderer is wired through Act4Concretization — imported here so the
// page-level type-checker validates the module exists.
import { PreviewRenderer } from '@/components/preview/PreviewRenderer';

// =====================================================================
// TYPES — mirror the hydrated snapshot built in page.tsx
// =====================================================================

type FieldStatus = 'PENDING' | 'PROPOSED' | 'EDITED' | 'APPROVED' | 'REJECTED';
type ItemStatus = 'PROPOSED' | 'EDITED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
type PipelineStatus =
  | 'RUNNING'
  | 'AWAITING_ADMIN'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
type PipelineStep =
  | 'CREATE_BRAND'
  | 'ENRICH_PROFILE'
  | 'VALIDATE_PROFILE'
  | 'GENERATE_STRATEGY'
  | 'VALIDATE_STRATEGY_ITEMS'
  | 'EXECUTE_ITEMS'
  | 'DONE';

interface FieldState {
  status?: FieldStatus;
  value?: unknown;
  rejectedReason?: string;
  history?: Array<{ at: string; by: string; value: unknown; source: 'ai' | 'user' }>;
}

interface ItemState {
  status?: ItemStatus;
  rejectedReason?: string;
  warnings?: string[];
}

export interface StrategyItemView {
  id: string;
  order: number;
  kind: string;
  status: string;
  title: string;
  description: string;
  platform: string | null;
  format: string | null;
  suggestedDate: string | null;
  hashtags: string[];
  cta: string | null;
  postId: string | null;
  campaignId: string | null;
}

interface UserView {
  id: string;
  name: string | null;
  email: string | null;
}

export interface BrandProfileView {
  slogan: string | null;
  mission: string | null;
  audienceTarget: string | null;
  toneOfVoice: string | null;
  wordsToUse: string[];
  wordsToAvoid: string[];
  officialHashtags: string[];
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  visualStyle: string | null;
}

export interface MediaAssetView {
  id: string;
  url: string;
  type: string;
  createdAt: string;
}

export interface PipelineView {
  id: string;
  organizationId: string;
  status: PipelineStatus;
  step: PipelineStep;
  horizon: string;
  language: string;
  seed: Record<string, unknown>;
  fieldStates: Record<string, FieldState | unknown>;
  itemStates: Record<string, ItemState | unknown>;
  executionLog: unknown[];
  trace: unknown[];
  adminNotes: string | null;
  approvedProfileAt: string | null;
  approvedStrategyAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedBy: UserView | null;
  approvedProfileBy: UserView | null;
  approvedStrategyBy: UserView | null;
  brand:
    | {
        id: string;
        name: string;
        industry: string | null;
        hasProfile: boolean;
        profile: BrandProfileView | null;
      }
    | null;
  strategy: {
    id: string;
    title: string;
    status: string;
    horizon: string | null;
    items: StrategyItemView[];
  } | null;
  recentMedia: MediaAssetView[];
  viewer: {
    userId: string;
    role: string;
    isSuperAdmin: boolean;
    canApprove: boolean;
  };
}

// =====================================================================
// 5-ACT NARRATIVE CONFIG
// =====================================================================

type ActStatus = 'pending' | 'running' | 'awaiting-approval' | 'done' | 'failed';

export interface ActMeta {
  id: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
  anchor: string;
  // Which BrandPipelineStep keys belong to this act.
  steps: PipelineStep[];
}

const ACTS: ActMeta[] = [
  {
    id: 1,
    title: 'Acte 1 — Déclaration de marque',
    subtitle: "L'utilisateur déclare l'ADN initial de la marque.",
    anchor: 'act-1',
    steps: ['CREATE_BRAND'],
  },
  {
    id: 2,
    title: 'Acte 2 — Enrichissement IA',
    subtitle: "L'agent enrichit le profil, l'admin valide chaque champ.",
    anchor: 'act-2',
    steps: ['ENRICH_PROFILE', 'VALIDATE_PROFILE'],
  },
  {
    id: 3,
    title: 'Acte 3 — Génération de stratégie',
    subtitle: "L'agent compose la stratégie marketing complète.",
    anchor: 'act-3',
    steps: ['GENERATE_STRATEGY'],
  },
  {
    id: 4,
    title: 'Acte 4 — Concrétisation',
    subtitle: 'Preview des items + validation individuelle.',
    anchor: 'act-4',
    steps: ['VALIDATE_STRATEGY_ITEMS'],
  },
  {
    id: 5,
    title: 'Acte 5 — Passage à l\'action',
    subtitle: 'Création des brouillons, planification, calendrier.',
    anchor: 'act-5',
    steps: ['EXECUTE_ITEMS', 'DONE'],
  },
];

const TERMINAL_STATUSES: PipelineStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

// =====================================================================
// HELPERS
// =====================================================================

function stepToActId(step: PipelineStep): 1 | 2 | 3 | 4 | 5 {
  for (const act of ACTS) {
    if (act.steps.includes(step)) return act.id;
  }
  return 1;
}

function computeActStatus(act: ActMeta, run: PipelineView): ActStatus {
  const curActId = stepToActId(run.step);
  if (run.status === 'COMPLETED') return act.id <= 5 ? 'done' : 'pending';
  if (run.status === 'FAILED' || run.status === 'CANCELLED') {
    if (act.id < curActId) return 'done';
    if (act.id === curActId) return 'failed';
    return 'pending';
  }
  if (act.id < curActId) return 'done';
  if (act.id > curActId) return 'pending';
  // Current act: refine based on run status.
  if (run.status === 'AWAITING_ADMIN') return 'awaiting-approval';
  return 'running';
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================

export function PipelineRunner({
  initial,
  pipelineId,
}: {
  initial: PipelineView;
  pipelineId: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState<PipelineView>(initial);
  const [autoMode, setAutoMode] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const lastAutoStepRef = useRef<PipelineStep | null>(null);
  const lastScrollActRef = useRef<number | null>(null);

  // -------------------- POLLING --------------------
  const refresh = useCallback(async (): Promise<PipelineView | null> => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: PipelineView };
      if (json?.data) {
        // Ne remplace l'état QUE si le serveur a réellement changé. Sinon chaque
        // poll créait un nouvel objet `run` → re-render complet des 5 actes
        // (aperçus, images) et page saccadée/non cliquable.
        setRun((prev) => {
          const next = json.data!;
          if (prev.updatedAt === next.updatedAt && prev.status === next.status) return prev;
          // L'API ne renvoie ni `viewer` ni `recentMedia` (calculés côté serveur
          // au premier rendu) — on les préserve, sinon run.viewer.canApprove
          // crashe au premier poll et le type ment sur recentMedia.
          return {
            ...next,
            viewer: next.viewer ?? prev.viewer,
            recentMedia: next.recentMedia ?? prev.recentMedia,
          };
        });
        return json.data;
      }
    } catch {
      // swallow — next poll retries
    }
    return null;
  }, [pipelineId]);

  // Polling adaptatif : 5 s onglet visible, suspendu onglet caché (le payload
  // d'un run est lourd — poller en arrière-plan saturait le pool DB).
  useEffect(() => {
    if (TERMINAL_STATUSES.includes(run.status)) return;
    let timer: number | undefined;
    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => {
        if (!document.hidden) void refresh();
      }, 5000);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [run.status, refresh]);

  // -------------------- ADVANCE --------------------
  const advance = useCallback(async (): Promise<boolean> => {
    if (advancing) return false;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/advance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: PipelineView;
        message?: string;
      };
      if (!res.ok) {
        toast.error(json?.message ?? "Impossible d'avancer le pipeline");
        return false;
      }
      if (json?.data) {
        const data = json.data;
        setRun((prev) => ({ ...data, viewer: data.viewer ?? prev.viewer }));
      } else await refresh();
      toast.success('Étape avancée');
      return true;
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Erreur réseau');
      return false;
    } finally {
      setAdvancing(false);
    }
  }, [advancing, pipelineId, refresh]);

  // Auto-mode: after each approval the status flips back to RUNNING with a
  // new step — fire advance() once per transition.
  useEffect(() => {
    if (!autoMode) return;
    if (TERMINAL_STATUSES.includes(run.status)) return;
    if (run.status !== 'RUNNING') return;
    if (lastAutoStepRef.current === run.step) return;
    lastAutoStepRef.current = run.step;
    void advance();
  }, [autoMode, run.status, run.step, advance]);

  // -------------------- SMART SCROLL --------------------
  const currentActId = useMemo(() => stepToActId(run.step), [run.step]);

  useEffect(() => {
    if (lastScrollActRef.current === currentActId) return;
    lastScrollActRef.current = currentActId;
    if (typeof window === 'undefined') return;
    const el = document.getElementById(`act-${currentActId}`);
    if (!el) return;
    // Defer slightly so layout settles after state change.
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [currentActId]);

  // Final redirect on completion.
  useEffect(() => {
    if (run.status !== 'COMPLETED') return;
    const log = run.executionLog as Array<{ scheduleId?: string | null; postId?: string | null }>;
    const firstSchedule = log.find((e) => e?.scheduleId)?.scheduleId;
    const firstPost = log.find((e) => e?.postId)?.postId;
    let target: string | null = null;
    if (firstSchedule && run.brand?.id)
      target = `/calendar?brand=${run.brand.id}&pipeline=${run.id}`;
    else if (firstPost) target = `/ai-studio?postId=${firstPost}`;
    else if (run.brand?.id) target = `/brands/${run.brand.id}`;
    if (target) {
      const dest = target;
      toast.success('Pipeline terminé !', { description: 'Redirection en cours…' });
      const t = window.setTimeout(() => router.push(dest), 1800);
      return () => window.clearTimeout(t);
    }
  }, [run.status, run.executionLog, run.brand?.id, run.id, router]);

  // -------------------- ACTIONS --------------------
  const cancel = useCallback(async () => {
    if (
      !window.confirm(
        'Annuler ce pipeline ? Les éléments déjà créés (marque, profil) restent en base.',
      )
    )
      return;
    setBusyKey('cancel');
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as {
        data?: PipelineView;
        message?: string;
      };
      if (!res.ok) {
        toast.error(json?.message ?? 'Annulation impossible');
        return;
      }
      const payload = json as { data?: PipelineView & { deleted?: boolean } };
      if ((payload.data as { deleted?: boolean } | undefined)?.deleted) {
        // Run zombie ou terminé → supprimé pour de bon; retour à la liste.
        toast.success('Pipeline supprimé');
        router.push('/pipelines');
        return;
      }
      if (payload?.data) {
        const data = payload.data;
        setRun((prev) => ({ ...data, viewer: data.viewer ?? prev.viewer }));
      }
      toast.success('Pipeline annulé');
    } finally {
      setBusyKey(null);
    }
  }, [pipelineId, router]);

  const scrollToAct = useCallback((actId: number) => {
    if (typeof window === 'undefined') return;
    const el = document.getElementById(`act-${actId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // -------------------- DERIVED --------------------
  const currentAct = ACTS.find((a) => a.id === currentActId) ?? ACTS[0];
  const brandName =
    run.brand?.name ??
    (typeof run.seed?.name === 'string' ? (run.seed.name as string) : 'Pipeline');

  const canAdvanceNow =
    !advancing &&
    !TERMINAL_STATUSES.includes(run.status) &&
    run.status !== 'AWAITING_ADMIN';

  // Common props passed to every Act component. Builders consume what they need.
  const actProps = {
    run,
    pipelineId,
    setRun,
    onAdvance: advance,
    refresh,
    // Les Actes 2/3/4 appellent `onChanged` après chaque écriture serveur pour
    // afficher le travail au fil de l'eau. Sans ce câblage, leurs appels
    // étaient des no-op : rien n'apparaissait avant un rechargement manuel.
    onChanged: refresh,
    busyKey,
    setBusyKey,
    // Défensif: viewer peut manquer sur un payload d'API — jamais de crash.
    canApprove: run.viewer?.canApprove ?? false,
  } as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      {/* ====== TOP BAR ====== */}
      <div className="flex flex-col gap-1">
        <Link
          href={run.brand ? `/brands/${run.brand.id}` : '/brands'}
          className="text-xs text-slate-500 hover:underline"
        >
          <ArrowLeft className="inline h-3 w-3" /> {run.brand ? `Marque ${run.brand.name}` : 'Marques'}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Workflow className="h-6 w-6 text-violet-600" />
          Pipeline — {brandName}
        </h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PipelineStatusBadge status={run.status} />
            <Badge variant="outline" className="text-[10px]">
              Horizon {run.horizon}
            </Badge>
            <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900">
              État actuel : Acte {currentAct.id} — {currentAct.title.replace(/^Acte \d+ — /, '')}
            </span>
            {run.startedBy ? (
              <span className="text-xs text-muted-foreground">
                démarré par {run.startedBy.name ?? run.startedBy.email ?? '?'}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => setAutoMode(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Mode auto
            </label>
            <Button
              variant="brand"
              size="sm"
              onClick={advance}
              disabled={!canAdvanceNow}
              title={
                run.status === 'AWAITING_ADMIN'
                  ? 'Cette étape attend une validation admin'
                  : 'Lancer la prochaine étape'
              }
            >
              {advancing ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Play className="mr-2 h-3 w-3" />
              )}
              Avancer
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              title="Rafraîchir maintenant"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            {!TERMINAL_STATUSES.includes(run.status) ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={busyKey === 'cancel'}
                title="Annuler le pipeline"
              >
                <Pause className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </CardContent>
        {run.failureReason ? (
          <div className="mx-4 mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            Échec : {run.failureReason}
          </div>
        ) : null}
      </Card>

      {/* ====== TWO-COLUMN: Acts (main) + Mini-map (sticky rail) ====== */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_220px]">
        {/* Acts column */}
        <div className="space-y-10">
          <section id="act-1" className="scroll-mt-20">
            <Act1BrandDeclaration {...actProps} />
          </section>
          <section id="act-2" className="scroll-mt-20">
            <Act2BrandEnrichment {...actProps} />
          </section>
          <section id="act-3" className="scroll-mt-20">
            <Act3StrategyGeneration {...actProps} />
          </section>
          <section id="act-4" className="scroll-mt-20">
            <Act4Concretization {...actProps} PreviewRenderer={PreviewRenderer} />
          </section>
          <section id="act-5" className="scroll-mt-20">
            <Act5Action {...actProps} />
          </section>
        </div>

        {/* Mini-map rail (sticky) */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Progression
            </div>
            <ul className="space-y-1">
              {ACTS.map((a) => {
                const status = computeActStatus(a, run);
                const isCurrent = a.id === currentActId;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => scrollToAct(a.id)}
                      className={cn(
                        'group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-xs transition-colors hover:border-slate-200 hover:bg-slate-50',
                        isCurrent && 'border-violet-200 bg-violet-50',
                      )}
                    >
                      <ActStatusDot status={status} />
                      <span className="flex-1 truncate">
                        <span className="block font-medium">Acte {a.id}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {a.title.replace(/^Acte \d+ — /, '')}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================

function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  const map: Record<
    PipelineStatus,
    { label: string; variant: 'secondary' | 'info' | 'success' | 'destructive' }
  > = {
    RUNNING: { label: '⏵ En cours', variant: 'info' },
    AWAITING_ADMIN: { label: '⏸ Attente admin', variant: 'secondary' },
    PAUSED: { label: '⏸ Pause', variant: 'secondary' },
    COMPLETED: { label: '✓ Terminé', variant: 'success' },
    FAILED: { label: '✗ Échec', variant: 'destructive' },
    CANCELLED: { label: '✗ Annulé', variant: 'destructive' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function ActStatusDot({ status }: { status: ActStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
    case 'running':
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />;
    case 'awaiting-approval':
      return <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />;
    case 'failed':
      return <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />;
    default:
      return <CircleDashed className="h-4 w-4 shrink-0 text-slate-400" />;
  }
}
