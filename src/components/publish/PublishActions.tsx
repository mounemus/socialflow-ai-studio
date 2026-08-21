'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, CalendarOff, CheckCircle2, Loader2, RotateCcw, Send, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ManualShareDialog } from '@/components/share/ManualShareDialog';
import { apiErrorMessage } from '@/lib/client-api-error';
import { publishPostInput, schedulePostInput } from '@/lib/contracts';
import { postStatusMeta, platformFromFormat } from '@/lib/post-status';

/** Sous-ensemble du post tel que renvoyé par GET /api/posts/[id]. */
export interface PublishablePost {
  id: string;
  status: string;
  format?: string | null;
  platform?: string | null;
  resolvedPlatform?: string | null;
  approvals?: Array<{ id: string; status: string }> | null;
  schedules?: Array<{ id: string; status: string; errorMessage?: string | null }> | null;
  destination?: {
    platform: string | null;
    mode: 'AUTO' | 'MANUAL';
    accountName: string | null;
    handle: string | null;
    link: 'zernio' | 'native' | 'manual';
    simulated: boolean;
  } | null;
  /** L'organisation exige une validation avant publication. */
  requireApproval?: boolean;
  /** Problèmes détectés avant publication (GET /api/posts/[id]). */
  preflight?: Array<{ level: 'error' | 'warning'; message: string }> | null;
}

function localDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const NEEDS_APPROVAL = new Set(['IDEA', 'DRAFT', 'PENDING_APPROVAL', 'REJECTED']);

/**
 * Actions de publication UNIQUES — mêmes boutons, mêmes routes, même vérité
 * dans la vue publication (/posts/[id]) et dans l'Atelier (onglet Publier).
 * Toute publication passe par /api/posts/[id]/publish ou /schedule
 * (resolvePublishTarget + assertPublishable + assertNotInFlight).
 */
export function PublishActions({
  post,
  onChanged,
}: {
  post: PublishablePost;
  /** Appelé après chaque action : le parent recharge le post. */
  onChanged: () => void | Promise<void>;
}) {
  const postId = post.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState('');
  useEffect(() => {
    setScheduleAt((p) => p || localDatetime(new Date(Date.now() + 60 * 60 * 1000)));
  }, []);

  const platform = post.resolvedPlatform ?? post.platform ?? platformFromFormat(post.format ?? null);
  const statusMeta = postStatusMeta(post.status);
  const isPublished = ['PUBLISHED', 'SIMULATED'].includes(post.status);
  const isScheduled = post.status === 'SCHEDULED';
  const pendingApprovalId = useMemo(
    () => (post.approvals ?? []).find((a) => a.status === 'PENDING')?.id ?? null,
    [post.approvals],
  );
  const failedSchedules = useMemo(
    () => (post.schedules ?? []).filter((s) => s.status === 'FAILED' || s.status === 'ACTION_REQUIRED'),
    [post.schedules],
  );
  // Porte de validation : seulement si l'organisation l'exige ET que le post
  // n'est pas encore validé — sinon on publie directement.
  const approvalGate = post.requireApproval === true && NEEDS_APPROVAL.has(post.status);
  const dest = post.destination ?? null;
  const preflight = post.preflight ?? [];
  // Erreur pré-vol = publication vouée à l'échec → boutons bloqués (le
  // problème est affiché, pas découvert à l'heure de la programmation).
  const preflightBlocked = preflight.some((i) => i.level === 'error');

  const run = useCallback(
    async (key: string, fn: () => Promise<string | void>, errPrefix?: string) => {
      setBusy(key);
      try {
        const msg = await fn();
        if (msg) toast.success(msg);
        await onChanged();
      } catch (err) {
        toast.error(`${errPrefix ? `${errPrefix} : ` : ''}${(err as Error).message.slice(0, 140)}`);
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const publish = () =>
    run(
      'publish',
      async () => {
        const res = await fetch(`/api/posts/${postId}/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(publishPostInput.parse({ platform: platform ?? undefined })),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        const j = (await res.json().catch(() => null)) as { data?: { mode?: string; message?: string } } | null;
        if (j?.data?.mode === 'MANUAL') {
          toast.info(j.data.message ?? 'Aucun compte connecté — publication manuelle requise.');
          return;
        }
        return 'Publié ✓';
      },
      'Publication échouée',
    );

  const schedule = () => {
    const at = new Date(scheduleAt);
    if (Number.isNaN(at.getTime())) return toast.error('Date invalide');
    return run('schedule', async () => {
      const res = await fetch(`/api/posts/${postId}/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(schedulePostInput.parse({ scheduledFor: at.toISOString(), platform: platform ?? undefined })),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const j = (await res.json().catch(() => null)) as { data?: { mode?: string } } | null;
      setSchedOpen(false);
      return j?.data?.mode === 'MANUAL'
        ? `Programmé — en partage manuel (aucun compte ${platform ?? ''} connecté)`
        : `Programmé pour ${at.toLocaleString()}`;
    });
  };

  const unschedule = () => {
    if (!window.confirm('Déprogrammer ? La publication retournera dans « Validés ».')) return;
    return run('unschedule', async () => {
      const res = await fetch(`/api/posts/${postId}/unschedule`, { method: 'POST' });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      return 'Déprogrammé — retour dans « Validés »';
    });
  };

  const approve = () =>
    run('approve', async () => {
      // Audit trail si une demande de validation existe, sinon transition directe.
      const res = pendingApprovalId
        ? await fetch(`/api/approvals/${pendingApprovalId}/approve`, { method: 'POST' })
        : await fetch(`/api/posts/${postId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'APPROVED' }),
          });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      return 'Publication validée';
    });

  const backToDraft = () =>
    run('draft', async () => {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      return 'Renvoyé en brouillon';
    });

  const requestApproval = () =>
    run('request', async () => {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, message: approvalMessage || undefined }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      return 'Validation demandée — visible dans la file de production.';
    });

  const retry = (scheduleId: string) =>
    run(
      `retry:${scheduleId}`,
      async () => {
        const res = await fetch(`/api/schedules/${scheduleId}/retry`, { method: 'POST' });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        return 'Republication relancée';
      },
      'Republication échouée',
    );

  const spin = (key: string, Icon: typeof Send) =>
    busy === key ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Icon className="mr-1 h-4 w-4" />;

  return (
    <div className="space-y-2">
      {/* Destination réelle — affichée AVANT de publier (capacité réelle). */}
      {dest ? (
        <div className="rounded-md border bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">Destination</span>
            <Badge variant="secondary" className="text-[10px]">{dest.platform ?? platform ?? '—'}</Badge>
            {dest.mode === 'AUTO' ? (
              <span>
                @{dest.handle ?? dest.accountName ?? 'compte'} ·{' '}
                {dest.link === 'zernio' ? 'via Zernio' : dest.link === 'native' ? 'connexion native' : 'compte'}
              </span>
            ) : (
              <span className="text-amber-700">aucun compte connecté → partage manuel</span>
            )}
            {dest.simulated ? <Badge variant="warning" className="text-[10px]">SIMULATION</Badge> : null}
          </div>
        </div>
      ) : null}

      {/* Pré-vol : problèmes montrés AVANT d'agir, erreurs bloquantes. */}
      {preflight.length > 0 ? (
        <div className="space-y-1">
          {preflight.map((i, idx) => (
            <p
              key={idx}
              className={
                i.level === 'error'
                  ? 'rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700'
                  : 'rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700'
              }
            >
              {i.message}
            </p>
          ))}
        </div>
      ) : null}

      {post.status === 'PENDING_APPROVAL' ? (
        <>
          <Button className="w-full" variant="brand" onClick={approve} disabled={busy !== null}>
            {spin('approve', CheckCircle2)} Valider la publication
          </Button>
          <Button className="w-full" variant="outline" onClick={backToDraft} disabled={busy !== null}>
            {spin('draft', RotateCcw)} Renvoyer en brouillon
          </Button>
          <div className="my-1 border-t" />
        </>
      ) : null}

      {isPublished ? (
        <>
          <p className="rounded-md bg-emerald-50 p-2 text-center text-xs text-emerald-700">
            Cette publication est {statusMeta.label.toLowerCase()}.
          </p>
          {/* Republier = NOUVEAU post sur le réseau (l'ancien reste en ligne) —
              utile quand le visuel a été ajouté après la publication. */}
          <Button
            className="w-full"
            variant="outline"
            onClick={() => {
              if (window.confirm('Republier crée un NOUVEAU post sur le réseau avec le texte et le visuel actuels. L’ancien post reste en ligne. Continuer ?')) void publish();
            }}
            disabled={busy !== null || preflightBlocked}
          >
            {spin('publish', RotateCcw)} Republier (nouveau post)
          </Button>
          <Button className="w-full" variant="ghost" onClick={() => setSchedOpen((v) => !v)} disabled={busy !== null}>
            <Calendar className="mr-1 h-4 w-4" /> Programmer une republication
          </Button>
          {schedOpen ? (
            <div className="rounded-md border bg-slate-50 p-2">
              <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="text-xs" />
              <Button size="sm" variant="brand" className="mt-2 w-full" onClick={schedule} disabled={busy === 'schedule' || preflightBlocked}>
                {busy === 'schedule' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Confirmer
              </Button>
            </div>
          ) : null}
        </>
      ) : approvalGate && post.status !== 'PENDING_APPROVAL' ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className="text-[11px] text-amber-800">
            Ton organisation exige une validation avant publication (Réglages → Flux de publication).
          </p>
          <textarea
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            rows={2}
            placeholder="Message pour le relecteur (optionnel)"
            value={approvalMessage}
            onChange={(e) => setApprovalMessage(e.target.value)}
          />
          <Button className="w-full" variant="brand" onClick={requestApproval} disabled={busy !== null}>
            {spin('request', CheckCircle2)} Demander la validation
          </Button>
        </div>
      ) : (
        <>
          <Button className="w-full" variant="outline" onClick={() => setSchedOpen((v) => !v)} disabled={busy !== null}>
            <Calendar className="mr-1 h-4 w-4" /> {isScheduled ? 'Reprogrammer' : 'Programmer'}
          </Button>
          {isScheduled ? (
            <Button className="w-full" variant="ghost" onClick={unschedule} disabled={busy !== null}>
              {spin('unschedule', CalendarOff)} Déprogrammer
            </Button>
          ) : null}
          {schedOpen ? (
            <div className="rounded-md border bg-slate-50 p-2">
              <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="text-xs" />
              <Button size="sm" variant="brand" className="mt-2 w-full" onClick={schedule} disabled={busy === 'schedule' || preflightBlocked}>
                {busy === 'schedule' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Confirmer
              </Button>
            </div>
          ) : null}
          <Button className="w-full" variant="brand" onClick={publish} disabled={busy !== null || preflightBlocked}>
            {spin('publish', Send)} Publier maintenant
          </Button>
          <Button className="w-full" variant="outline" onClick={() => setShareOpen(true)} disabled={busy !== null}>
            <Share2 className="mr-1 h-4 w-4" /> Partager manuellement
          </Button>
        </>
      )}

      {failedSchedules.length > 0 ? (
        <>
          <div className="my-1 border-t" />
          <p className="text-xs font-medium text-rose-700">Échecs de publication</p>
          {failedSchedules.map((s) => (
            <div key={s.id} className="rounded-md border border-rose-200 bg-rose-50 p-2">
              <p className="text-[11px] text-rose-700">{(s.errorMessage ?? 'Publication échouée.').slice(0, 140)}</p>
              <Button size="sm" variant="outline" className="mt-1 w-full" onClick={() => retry(s.id)} disabled={busy !== null}>
                {busy === `retry:${s.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                Republier
              </Button>
            </div>
          ))}
        </>
      ) : null}

      <ManualShareDialog postId={postId} open={shareOpen} onClose={() => setShareOpen(false)} onShared={onChanged} />
    </div>
  );
}
