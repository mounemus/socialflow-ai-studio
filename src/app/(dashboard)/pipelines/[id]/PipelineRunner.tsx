'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Loader2,
  Check,
  X,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Pause,
  Play,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleAlert,
  Rocket,
  Pencil,
  FileText,
  Workflow,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// =====================================================================
// TYPES — mirror the BrandPipelineRun snapshot built in page.tsx
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

interface StrategyItemView {
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
  brand: { id: string; name: string; industry: string | null; hasProfile: boolean } | null;
  strategy: {
    id: string;
    title: string;
    status: string;
    horizon: string | null;
    items: StrategyItemView[];
  } | null;
  viewer: {
    userId: string;
    role: string;
    isSuperAdmin: boolean;
    canApprove: boolean;
  };
}

// Alias kept for backwards compatibility with the previous placeholder shell.
export type PipelineRunnerInitial = PipelineView;

// =====================================================================
// CONFIG — state machine descriptors used by the stepper
// =====================================================================

const STEPS: Array<{
  key: PipelineStep;
  label: string;
  adminGate: boolean;
  description: string;
}> = [
  {
    key: 'CREATE_BRAND',
    label: 'Création marque',
    adminGate: false,
    description: "Création de la marque + profil vide à partir des informations initiales.",
  },
  {
    key: 'ENRICH_PROFILE',
    label: 'Enrichissement IA du profil',
    adminGate: false,
    description:
      "L'agent propose en parallèle slogan, mission, audience, ton, hashtags, couleurs…",
  },
  {
    key: 'VALIDATE_PROFILE',
    label: 'Validation du profil',
    adminGate: true,
    description:
      'Approuve, édite ou régénère chaque champ. Un admin valide ensuite le profil global.',
  },
  {
    key: 'GENERATE_STRATEGY',
    label: 'Génération stratégie',
    adminGate: false,
    description: "L'agent compose la stratégie marketing complète + plan d'action.",
  },
  {
    key: 'VALIDATE_STRATEGY_ITEMS',
    label: 'Validation des items',
    adminGate: true,
    description:
      'Approuve les actions individuelles (posts, campagnes, ads, expériments). Édite ou régénère si besoin.',
  },
  {
    key: 'EXECUTE_ITEMS',
    label: 'Exécution & planification',
    adminGate: false,
    description: 'Création des brouillons + planification automatique dans le calendrier.',
  },
  {
    key: 'DONE',
    label: 'Terminé',
    adminGate: false,
    description: 'Pipeline complet — accès au calendrier et au studio IA.',
  },
];

const TERMINAL_STATUSES: PipelineStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

// 11 enrichable brand-profile fields (matches BRAND_PROFILE_FIELDS in the service).
const BRAND_PROFILE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'slogan', label: 'Slogan' },
  { key: 'mission', label: 'Mission' },
  { key: 'audienceTarget', label: 'Audience cible' },
  { key: 'toneOfVoice', label: 'Ton de voix' },
  { key: 'wordsToUse', label: 'Mots à utiliser' },
  { key: 'wordsToAvoid', label: 'Mots à éviter' },
  { key: 'officialHashtags', label: 'Hashtags officiels' },
  { key: 'primaryColor', label: 'Couleur primaire' },
  { key: 'secondaryColor', label: 'Couleur secondaire' },
  { key: 'accentColor', label: "Couleur d'accent" },
  { key: 'visualStyle', label: 'Style visuel' },
];

// =====================================================================
// HELPERS
// =====================================================================

function stepIndex(step: PipelineStep): number {
  return STEPS.findIndex((s) => s.key === step);
}

function getFieldState(states: Record<string, unknown>, key: string): FieldState {
  const raw = states?.[key];
  if (raw && typeof raw === 'object') return raw as FieldState;
  return { status: 'PENDING' };
}

function getItemState(states: Record<string, unknown>, id: string): ItemState {
  const raw = states?.[id];
  if (raw && typeof raw === 'object') return raw as ItemState;
  return { status: 'PROPOSED' };
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return (v as unknown[]).map((x) => String(x)).join(', ');
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '[object]';
    }
  }
  return String(v);
}

function fieldBadgeVariant(s: FieldStatus): 'secondary' | 'info' | 'success' | 'destructive' {
  switch (s) {
    case 'APPROVED':
      return 'success';
    case 'EDITED':
      return 'info';
    case 'REJECTED':
      return 'destructive';
    case 'PROPOSED':
      return 'info';
    default:
      return 'secondary';
  }
}

/** Whether the admin gate for the given step has been crossed. */
function approvedFor(run: PipelineView, step: PipelineStep): boolean {
  switch (step) {
    case 'VALIDATE_PROFILE':
      return !!run.approvedProfileAt;
    case 'VALIDATE_STRATEGY_ITEMS':
      return !!run.approvedStrategyAt;
    default:
      return true;
  }
}

type StepStatus = 'pending' | 'running' | 'awaiting-approval' | 'done' | 'failed';

function computeStepStatus(
  step: PipelineStep,
  run: PipelineView,
  currentRunStatus: StepStatus,
): StepStatus {
  const cur = stepIndex(run.step);
  const me = stepIndex(step);
  if (run.status === 'COMPLETED') return me <= cur ? 'done' : 'pending';
  if (run.status === 'FAILED' || run.status === 'CANCELLED') {
    if (me < cur) return 'done';
    if (me === cur) return 'failed';
    return 'pending';
  }
  if (me < cur) return 'done';
  if (me === cur) return currentRunStatus;
  return 'pending';
}

interface LogEntry {
  kind: string;
  at?: string;
  detail?: string;
}

function deriveLog(run: PipelineView): LogEntry[] {
  const out: LogEntry[] = [];
  const trace = Array.isArray(run.trace) ? run.trace : [];
  for (const e of trace) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    const kind = typeof rec.kind === 'string' ? rec.kind : 'EVENT';
    const at = typeof rec.at === 'string' ? rec.at : undefined;
    let detail: string | undefined;
    const payload = rec.payload;
    if (payload && typeof payload === 'object') {
      try {
        const s = JSON.stringify(payload);
        detail = s.length > 160 ? s.slice(0, 160) + '…' : s;
      } catch {
        // ignore
      }
    }
    out.push({ kind, at, detail });
  }
  const log = Array.isArray(run.executionLog) ? run.executionLog : [];
  for (const e of log) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    out.push({
      kind: 'ITEM_EXECUTED',
      detail:
        [
          rec.itemId ? `item ${String(rec.itemId)}` : null,
          rec.postId ? `post ${String(rec.postId)}` : null,
          rec.scheduleId ? `schedule ${String(rec.scheduleId)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    });
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 10);
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================

export function PipelineRunner({ initial }: { initial: PipelineView }) {
  const router = useRouter();
  const [run, setRun] = useState<PipelineView>(initial);
  const [autoMode, setAutoMode] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<PipelineStep | null>(initial.step);
  const lastAdvancedStepRef = useRef<PipelineStep | null>(null);

  // Refresh single pipeline snapshot from the polling endpoint.
  const refresh = useCallback(async (): Promise<PipelineView | null> => {
    try {
      const res = await fetch(`/api/pipelines/${run.id}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: PipelineView };
      if (json?.data) {
        setRun(json.data);
        return json.data;
      }
    } catch {
      // swallow — next poll will retry
    }
    return null;
  }, [run.id]);

  // Polling while non-terminal.
  useEffect(() => {
    if (TERMINAL_STATUSES.includes(run.status)) return;
    const t = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(t);
  }, [run.status, refresh]);

  // Current step status helper.
  const currentStepStatus = useMemo<StepStatus>(() => {
    if (run.status === 'COMPLETED') return 'done';
    if (run.status === 'FAILED' || run.status === 'CANCELLED') return 'failed';
    if (run.status === 'AWAITING_ADMIN') return 'awaiting-approval';
    return 'running';
  }, [run.status]);

  // Advance the pipeline (calls the central dispatcher endpoint).
  const advance = useCallback(async (): Promise<boolean> => {
    if (advancing) return false;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/pipelines/${run.id}/advance`, {
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
      if (json?.data) setRun(json.data);
      else await refresh();
      toast.success('Étape avancée');
      return true;
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Erreur réseau');
      return false;
    } finally {
      setAdvancing(false);
    }
  }, [advancing, run.id, refresh]);

  // Auto-mode: when status becomes RUNNING (post-approval) and the step changes,
  // automatically call advance() once per step transition.
  useEffect(() => {
    if (!autoMode) return;
    if (TERMINAL_STATUSES.includes(run.status)) return;
    if (run.status !== 'RUNNING') return;
    if (lastAdvancedStepRef.current === run.step) return;
    lastAdvancedStepRef.current = run.step;
    void advance();
  }, [autoMode, run.status, run.step, advance]);

  // Final redirect once completed.
  useEffect(() => {
    if (run.status !== 'COMPLETED') return;
    const log = run.executionLog as Array<{ scheduleId?: string | null; postId?: string | null }>;
    const firstSchedule = log.find((e) => e?.scheduleId)?.scheduleId;
    const firstPost = log.find((e) => e?.postId)?.postId;
    let target: string | null = null;
    if (firstSchedule && run.brand?.id) target = `/calendar?brand=${run.brand.id}&pipeline=${run.id}`;
    else if (firstPost) target = `/ai-studio?postId=${firstPost}`;
    else if (run.brand?.id) target = `/brands/${run.brand.id}`;
    if (target) {
      const dest = target;
      toast.success('Pipeline terminé !', { description: 'Redirection en cours…' });
      const t = window.setTimeout(() => router.push(dest), 1800);
      return () => window.clearTimeout(t);
    }
  }, [run.status, run.executionLog, run.brand?.id, run.id, router]);

  // Field-level actions ===============================================
  const fieldAction = useCallback(
    async (
      field: string,
      action: 'approve' | 'reject' | 'regenerate' | 'edit',
      payload?: { value?: unknown; reason?: string },
    ) => {
      const key = `field:${field}:${action}`;
      setBusyKey(key);
      try {
        const res = await fetch(`/api/pipelines/${run.id}/fields/${field}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...payload }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: PipelineView;
          message?: string;
        };
        if (!res.ok) {
          toast.error(json?.message ?? 'Action échouée');
          return;
        }
        if (json?.data) setRun(json.data);
        else await refresh();
        toast.success(
          action === 'approve'
            ? 'Champ approuvé'
            : action === 'reject'
              ? 'Champ rejeté'
              : action === 'regenerate'
                ? 'Champ régénéré'
                : 'Champ mis à jour',
        );
      } catch (e) {
        toast.error((e as Error)?.message ?? 'Erreur réseau');
      } finally {
        setBusyKey(null);
      }
    },
    [run.id, refresh],
  );

  // Approve profile (admin gate transition out of VALIDATE_PROFILE).
  const approveProfile = useCallback(async () => {
    setBusyKey('approve-profile');
    try {
      const res = await fetch(`/api/pipelines/${run.id}/approve-profile`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        data?: PipelineView;
        message?: string;
      };
      if (!res.ok) {
        toast.error(json?.message ?? 'Validation impossible');
        return;
      }
      if (json?.data) setRun(json.data);
      else await refresh();
      toast.success('Profil approuvé');
    } finally {
      setBusyKey(null);
    }
  }, [run.id, refresh]);

  // Strategy-item actions =============================================
  const itemAction = useCallback(
    async (
      itemId: string,
      action: 'approve' | 'reject' | 'regenerate' | 'edit',
      payload?: Record<string, unknown>,
    ) => {
      const key = `item:${itemId}:${action}`;
      setBusyKey(key);
      try {
        const res = await fetch(`/api/pipelines/${run.id}/items/${itemId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...(payload ?? {}) }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: PipelineView;
          message?: string;
        };
        if (!res.ok) {
          toast.error(json?.message ?? 'Action item échouée');
          return;
        }
        if (json?.data) setRun(json.data);
        else await refresh();
        toast.success(
          action === 'approve'
            ? 'Item approuvé'
            : action === 'reject'
              ? 'Item rejeté'
              : action === 'regenerate'
                ? 'Item régénéré'
                : 'Item mis à jour',
        );
      } finally {
        setBusyKey(null);
      }
    },
    [run.id, refresh],
  );

  const approveStrategy = useCallback(async () => {
    setBusyKey('approve-strategy');
    try {
      const res = await fetch(`/api/pipelines/${run.id}/approve-strategy`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        data?: PipelineView;
        message?: string;
      };
      if (!res.ok) {
        toast.error(json?.message ?? 'Validation impossible');
        return;
      }
      if (json?.data) setRun(json.data);
      else await refresh();
      toast.success('Stratégie approuvée');
    } finally {
      setBusyKey(null);
    }
  }, [run.id, refresh]);

  const cancel = useCallback(async () => {
    if (
      !window.confirm(
        'Annuler ce pipeline ? Les éléments déjà créés (marque, profil) restent en base.',
      )
    )
      return;
    setBusyKey('cancel');
    try {
      const res = await fetch(`/api/pipelines/${run.id}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as {
        data?: PipelineView;
        message?: string;
      };
      if (!res.ok) {
        toast.error(json?.message ?? 'Annulation impossible');
        return;
      }
      if (json?.data) setRun(json.data);
      toast.success('Pipeline annulé');
    } finally {
      setBusyKey(null);
    }
  }, [run.id]);

  // Step gating: advance disabled when the current step requires admin approval.
  const currentStepDef = STEPS.find((s) => s.key === run.step) ?? STEPS[0];
  const isAwaitingApproval =
    run.status === 'AWAITING_ADMIN' ||
    (currentStepDef.adminGate && !TERMINAL_STATUSES.includes(run.status));

  const canAdvanceNow =
    !advancing &&
    !TERMINAL_STATUSES.includes(run.status) &&
    run.status !== 'AWAITING_ADMIN' &&
    !(currentStepDef.adminGate && !approvedFor(run, currentStepDef.key));

  // Build the activity log entries from trace + executionLog (last 10).
  const logEntries = useMemo(() => deriveLog(run), [run]);

  return (
    <div className="space-y-6">
      {/* ====== TOP CONTROL BAR ====== */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PipelineStatusBadge status={run.status} />
            <Badge variant="outline" className="text-[10px]">
              {currentStepDef.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Horizon {run.horizon} · démarré par{' '}
              {run.startedBy?.name ?? run.startedBy?.email ?? '?'}
            </span>
            {run.brand ? (
              <Link
                href={`/brands/${run.brand.id}`}
                className="text-xs text-brand-600 hover:underline"
              >
                → {run.brand.name}
              </Link>
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
                isAwaitingApproval
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

      {/* ====== VERTICAL STEPPER ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4 text-violet-600" />
            État du pipeline
          </CardTitle>
          <CardDescription>
            Cliquez sur une étape pour la déplier. Les étapes futures sont grisées.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {STEPS.map((s, idx) => {
            const stepStatus = computeStepStatus(s.key, run, currentStepStatus);
            const open = expandedStep === s.key;
            return (
              <StepCard
                key={s.key}
                step={s}
                index={idx}
                status={stepStatus}
                open={open}
                onToggle={() => setExpandedStep(open ? null : s.key)}
              >
                {open
                  ? renderStepContent(s.key, run, {
                      busyKey,
                      fieldAction,
                      itemAction,
                      approveProfile,
                      approveStrategy,
                      canApprove: run.viewer.canApprove,
                    })
                  : null}
              </StepCard>
            );
          })}
        </CardContent>
      </Card>

      {/* ====== ACTIVITY LOG ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Activité récente
          </CardTitle>
          <CardDescription>10 dernières actions du pipeline.</CardDescription>
        </CardHeader>
        <CardContent>
          {logEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Pas encore d&apos;événement.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {logEntries.map((e, i) => (
                <li key={i} className="flex items-start gap-2 rounded border bg-slate-50/50 p-2">
                  <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
                  <div className="flex-1">
                    <div className="font-medium">{e.kind}</div>
                    {e.at ? (
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(e.at).toLocaleString('fr-FR')}
                      </div>
                    ) : null}
                    {e.detail ? <div className="text-muted-foreground">{e.detail}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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

function StepCard({
  step,
  index,
  status,
  open,
  onToggle,
  children,
}: {
  step: { key: PipelineStep; label: string; adminGate: boolean; description: string };
  index: number;
  status: StepStatus;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const grayed = status === 'pending';
  return (
    <div
      className={cn(
        'rounded-lg border transition-colors',
        status === 'done' && 'border-emerald-200 bg-emerald-50/40',
        status === 'awaiting-approval' && 'border-amber-300 bg-amber-50/40',
        status === 'running' && 'border-violet-200 bg-violet-50/40',
        status === 'failed' && 'border-rose-300 bg-rose-50/40',
        grayed && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left"
        disabled={grayed}
      >
        <StepStatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">{index + 1}.</span>
            <span className="text-sm font-semibold">{step.label}</span>
            {step.adminGate ? (
              <Badge variant="outline" className="text-[9px] uppercase">
                Gate admin
              </Badge>
            ) : null}
            <StepStatusBadge status={status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
        </div>
        {!grayed ? (
          open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )
        ) : null}
      </button>
      {open ? <div className="border-t bg-white p-3">{children}</div> : null}
    </div>
  );
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-violet-600" />;
    case 'awaiting-approval':
      return <CircleAlert className="h-5 w-5 text-amber-600" />;
    case 'failed':
      return <X className="h-5 w-5 text-rose-600" />;
    default:
      return <CircleDashed className="h-5 w-5 text-slate-400" />;
  }
}

function StepStatusBadge({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return (
        <Badge variant="success" className="text-[9px]">
          Terminé
        </Badge>
      );
    case 'running':
      return (
        <Badge variant="info" className="text-[9px]">
          En cours
        </Badge>
      );
    case 'awaiting-approval':
      return (
        <Badge variant="secondary" className="text-[9px]">
          Approbation requise
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" className="text-[9px]">
          Échec
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[9px]">
          À venir
        </Badge>
      );
  }
}

// =====================================================================
// STEP CONTENT RENDERERS
// =====================================================================

interface StepActionsCtx {
  busyKey: string | null;
  canApprove: boolean;
  fieldAction: (
    field: string,
    action: 'approve' | 'reject' | 'regenerate' | 'edit',
    payload?: { value?: unknown; reason?: string },
  ) => Promise<void>;
  itemAction: (
    itemId: string,
    action: 'approve' | 'reject' | 'regenerate' | 'edit',
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  approveProfile: () => Promise<void>;
  approveStrategy: () => Promise<void>;
}

function renderStepContent(
  step: PipelineStep,
  run: PipelineView,
  ctx: StepActionsCtx,
): React.ReactNode {
  switch (step) {
    case 'CREATE_BRAND':
      return <SeedSummary run={run} />;
    case 'ENRICH_PROFILE':
      return <ProfileFieldsPreview run={run} />;
    case 'VALIDATE_PROFILE':
      return <ProfileValidation run={run} ctx={ctx} />;
    case 'GENERATE_STRATEGY':
      return <StrategyPreview run={run} />;
    case 'VALIDATE_STRATEGY_ITEMS':
      return <StrategyItemsValidation run={run} ctx={ctx} />;
    case 'EXECUTE_ITEMS':
      return <ExecutionSummary run={run} />;
    case 'DONE':
      return <DoneSummary run={run} />;
    default:
      return null;
  }
}

function SeedSummary({ run }: { run: PipelineView }) {
  const seed = run.seed;
  const entries = Object.entries(seed).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucune donnée seed enregistrée.</p>;
  }
  return (
    <dl className="grid gap-2 text-xs md:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded border bg-slate-50/60 p-2">
          <dt className="text-[10px] uppercase tracking-wider text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileFieldsPreview({ run }: { run: PipelineView }) {
  return (
    <div className="space-y-1.5">
      {BRAND_PROFILE_FIELDS.map((f) => {
        const st = getFieldState(run.fieldStates as Record<string, unknown>, f.key);
        return (
          <div
            key={f.key}
            className="flex items-center justify-between gap-3 rounded border bg-slate-50/60 p-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{f.label}</span>
                <Badge variant={fieldBadgeVariant(st.status ?? 'PENDING')} className="text-[9px]">
                  {st.status ?? 'PENDING'}
                </Badge>
              </div>
              {st.value != null ? (
                <div className="mt-0.5 truncate text-muted-foreground">{formatValue(st.value)}</div>
              ) : (
                <div className="mt-0.5 text-[10px] italic text-slate-400">Non proposé</div>
              )}
            </div>
            {st.status === 'PROPOSED' || st.status === 'EDITED' ? (
              <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ProfileValidation({ run, ctx }: { run: PipelineView; ctx: StepActionsCtx }) {
  const allApproved = BRAND_PROFILE_FIELDS.every((f) => {
    const st = getFieldState(run.fieldStates as Record<string, unknown>, f.key);
    return st.status === 'APPROVED';
  });
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {BRAND_PROFILE_FIELDS.map((f) => (
          <FieldRow key={f.key} field={f.key} label={f.label} run={run} ctx={ctx} />
        ))}
      </div>
      {run.approvedProfileAt ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
          ✓ Profil approuvé le {new Date(run.approvedProfileAt).toLocaleString('fr-FR')}
          {run.approvedProfileBy
            ? ` par ${run.approvedProfileBy.name ?? run.approvedProfileBy.email}`
            : ''}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border bg-amber-50 p-3 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-amber-900">
            {allApproved
              ? 'Tous les champs sont prêts. Valide le profil pour passer à la stratégie.'
              : 'Approuve, édite ou régénère chaque champ avant de valider le profil.'}
          </div>
          <Button
            variant="brand"
            size="sm"
            onClick={ctx.approveProfile}
            disabled={!ctx.canApprove || !allApproved || ctx.busyKey === 'approve-profile'}
            title={!ctx.canApprove ? 'Réservé aux admins' : undefined}
          >
            {ctx.busyKey === 'approve-profile' ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-2 h-3 w-3" />
            )}
            Valider le profil
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  label,
  run,
  ctx,
}: {
  field: string;
  label: string;
  run: PipelineView;
  ctx: StepActionsCtx;
}) {
  const st = getFieldState(run.fieldStates as Record<string, unknown>, field);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    Array.isArray(st.value)
      ? (st.value as unknown[]).map((x) => String(x)).join(', ')
      : ((st.value as string | undefined) ?? ''),
  );
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const busyApprove = ctx.busyKey === `field:${field}:approve`;
  const busyReject = ctx.busyKey === `field:${field}:reject`;
  const busyRegen = ctx.busyKey === `field:${field}:regenerate`;
  const busyEdit = ctx.busyKey === `field:${field}:edit`;
  const locked = st.status === 'APPROVED' || !!run.approvedProfileAt;

  return (
    <div className="rounded-md border bg-white p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          <Badge variant={fieldBadgeVariant(st.status ?? 'PENDING')} className="text-[9px]">
            {st.status ?? 'PENDING'}
          </Badge>
        </div>
        {!locked ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void ctx.fieldAction(field, 'regenerate')}
              disabled={busyRegen}
              title="Régénérer ce champ"
            >
              {busyRegen ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing((e) => !e)}
              disabled={busyEdit}
              title="Éditer"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void ctx.fieldAction(field, 'approve')}
              disabled={busyApprove || st.status === 'PENDING'}
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              {busyApprove ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectMode((v) => !v)}
              disabled={busyReject || st.status === 'PENDING'}
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
      </div>
      {st.value != null && !editing ? (
        <div className="mt-1 break-words text-muted-foreground">{formatValue(st.value)}</div>
      ) : st.value == null && !editing ? (
        <div className="mt-1 text-[10px] italic text-slate-400">Pas encore proposé</div>
      ) : null}

      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            rows={2}
            className="text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="brand"
              size="sm"
              disabled={busyEdit}
              onClick={async () => {
                await ctx.fieldAction(field, 'edit', { value: draft });
                setEditing(false);
              }}
            >
              {busyEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enregistrer'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {rejectMode ? (
        <div className="mt-2 space-y-2 rounded border border-rose-200 bg-rose-50 p-2">
          <Label className="text-[10px]">
            Motif du rejet (sert d&apos;instruction à la régénération)
          </Label>
          <Textarea
            rows={2}
            className="text-xs"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Ex: trop générique, on veut plus B2B…"
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busyReject}
              onClick={async () => {
                await ctx.fieldAction(field, 'reject', { reason: rejectReason });
                setRejectMode(false);
                setRejectReason('');
              }}
            >
              {busyReject ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Rejeter'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejectMode(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {st.rejectedReason ? (
        <div className="mt-1 rounded border border-rose-200 bg-rose-50 p-1 text-[10px] text-rose-900">
          Motif précédent : {st.rejectedReason}
        </div>
      ) : null}
    </div>
  );
}

function StrategyPreview({ run }: { run: PipelineView }) {
  if (!run.strategy) {
    return (
      <p className="text-xs text-muted-foreground">
        Stratégie pas encore générée. L&apos;agent va composer ~10–20 items à partir du profil
        approuvé.
      </p>
    );
  }
  const s = run.strategy;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">{s.title}</div>
      <div className="text-[10px] text-muted-foreground">
        Status : {s.status} · Horizon : {s.horizon ?? '—'} · {s.items.length} items
      </div>
    </div>
  );
}

function StrategyItemsValidation({ run, ctx }: { run: PipelineView; ctx: StepActionsCtx }) {
  if (!run.strategy) {
    return <p className="text-xs text-muted-foreground">Stratégie non disponible.</p>;
  }
  const items = run.strategy.items;
  const approvedCount = items.filter((i) => {
    const st = getItemState(run.itemStates as Record<string, unknown>, i.id);
    return (st.status ?? i.status) === 'APPROVED';
  }).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          {items.length} items · {approvedCount} approuvé{approvedCount > 1 ? 's' : ''}
        </div>
        {run.approvedStrategyAt ? (
          <Badge variant="success">
            ✓ Validée {new Date(run.approvedStrategyAt).toLocaleDateString('fr-FR')}
          </Badge>
        ) : (
          <Button
            variant="brand"
            size="sm"
            disabled={
              !ctx.canApprove || approvedCount === 0 || ctx.busyKey === 'approve-strategy'
            }
            onClick={ctx.approveStrategy}
          >
            {ctx.busyKey === 'approve-strategy' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1 h-3 w-3" />
            )}
            Approuver la stratégie
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} run={run} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  run,
  ctx,
}: {
  item: StrategyItemView;
  run: PipelineView;
  ctx: StepActionsCtx;
}) {
  const st = getItemState(run.itemStates as Record<string, unknown>, item.id);
  const status = (st.status ?? item.status) as string;
  const [expanded, setExpanded] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const busyApprove = ctx.busyKey === `item:${item.id}:approve`;
  const busyReject = ctx.busyKey === `item:${item.id}:reject`;
  const busyRegen = ctx.busyKey === `item:${item.id}:regenerate`;

  return (
    <div
      className={cn(
        'rounded-md border bg-white p-2 text-xs',
        status === 'APPROVED' && 'border-emerald-300 bg-emerald-50/30',
        status === 'REJECTED' && 'border-rose-300 bg-rose-50/30 opacity-70',
        status === 'EXECUTED' && 'border-brand-300 bg-brand-50/30',
      )}
    >
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[9px]">
              {item.kind.replace('_IDEA', '').replace('_', ' ')}
            </Badge>
            {item.platform ? (
              <Badge variant="secondary" className="text-[9px]">
                {item.platform}
              </Badge>
            ) : null}
            <Badge
              variant={
                status === 'APPROVED'
                  ? 'success'
                  : status === 'REJECTED'
                    ? 'destructive'
                    : status === 'EXECUTED'
                      ? 'info'
                      : 'secondary'
              }
              className="text-[9px]"
            >
              {status}
            </Badge>
          </div>
          <div className="mt-0.5 truncate font-medium">{item.title}</div>
          {expanded ? (
            <p className="mt-1 text-muted-foreground">{item.description}</p>
          ) : (
            <p className="mt-0.5 line-clamp-1 text-muted-foreground">{item.description}</p>
          )}
          <button
            type="button"
            className="mt-0.5 text-[10px] text-slate-500 hover:text-slate-900"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Réduire' : 'Détails'}
          </button>
          {st.warnings && st.warnings.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-[10px] text-amber-700">
              {st.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {st.rejectedReason ? (
            <div className="mt-1 rounded border border-rose-200 bg-rose-50 p-1 text-[10px] text-rose-900">
              Motif : {st.rejectedReason}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          {status === 'PROPOSED' || status === 'EDITED' ? (
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={busyApprove}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => void ctx.itemAction(item.id, 'approve')}
              >
                {busyApprove ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busyReject}
                className="border-rose-300 text-rose-700 hover:bg-rose-50"
                onClick={() => setRejectMode((v) => !v)}
              >
                <X className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busyRegen}
                onClick={() => void ctx.itemAction(item.id, 'regenerate')}
                title="Régénérer cet item"
              >
                {busyRegen ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
              </Button>
            </div>
          ) : null}
          {status === 'EXECUTED' && item.postId ? (
            <Link
              href={`/posts/${item.postId}`}
              className="text-[10px] text-brand-600 hover:underline"
            >
              <Rocket className="mr-0.5 inline h-3 w-3" />
              brouillon
            </Link>
          ) : null}
        </div>
      </div>
      {rejectMode ? (
        <div className="mt-2 space-y-2 rounded border border-rose-200 bg-rose-50 p-2">
          <Label className="text-[10px]">Motif du rejet</Label>
          <Textarea
            rows={2}
            className="text-xs"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Pourquoi cet item ne convient pas ?"
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busyReject}
              onClick={async () => {
                await ctx.itemAction(item.id, 'reject', { reason: rejectReason });
                setRejectMode(false);
                setRejectReason('');
              }}
            >
              {busyReject ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Rejeter'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejectMode(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionSummary({ run }: { run: PipelineView }) {
  const log = run.executionLog as Array<{
    itemId?: string;
    postId?: string | null;
    scheduleId?: string | null;
    warnings?: string[];
  }>;
  if (!log || log.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Pas encore d&apos;exécution. L&apos;agent va créer les brouillons et planifier les items
        approuvés.
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-xs">
      {log.map((entry, i) => (
        <li key={i} className="rounded border bg-slate-50/60 p-2">
          <div className="flex items-center gap-2">
            <Rocket className="h-3 w-3 text-brand-600" />
            <span>
              Item {entry.itemId ?? '?'} →
              {entry.postId ? (
                <Link
                  href={`/posts/${entry.postId}`}
                  className="ml-1 text-brand-600 hover:underline"
                >
                  brouillon créé
                </Link>
              ) : null}
              {entry.scheduleId ? (
                <Badge variant="info" className="ml-1 text-[9px]">
                  planifié
                </Badge>
              ) : null}
            </span>
          </div>
          {entry.warnings && entry.warnings.length > 0 ? (
            <ul className="mt-0.5 list-inside list-disc text-[10px] text-amber-700">
              {entry.warnings.map((w, k) => (
                <li key={k}>{w}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DoneSummary({ run }: { run: PipelineView }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
        ✓ Pipeline terminé
        {run.completedAt ? ` le ${new Date(run.completedAt).toLocaleString('fr-FR')}` : ''}.
      </div>
      <div className="flex flex-wrap gap-2">
        {run.brand ? (
          <Link
            href={`/brands/${run.brand.id}`}
            className="rounded border bg-white px-2 py-1 hover:bg-slate-50"
          >
            → Marque {run.brand.name}
          </Link>
        ) : null}
        <Link
          href={`/calendar${run.brand ? `?brand=${run.brand.id}&pipeline=${run.id}` : ''}`}
          className="rounded border bg-white px-2 py-1 hover:bg-slate-50"
        >
          → Calendrier
        </Link>
      </div>
    </div>
  );
}
