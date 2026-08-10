'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CalendarOff,
  CheckCircle2,
  Loader2,
  Calendar,
  Send,
  Share2,
  Pencil,
  RotateCcw,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SocialTextEditor } from '@/components/ui/social-text-editor';
import { ManualShareDialog } from '@/components/share/ManualShareDialog';
import { AttachVisual } from '@/components/media/AttachVisual';
import { apiErrorMessage } from '@/lib/client-api-error';
import { publishPostInput, schedulePostInput } from '@/lib/contracts';
import { postStatusMeta, platformFromFormat } from '@/lib/post-status';

interface PostFull {
  id: string;
  title: string | null;
  body: string | null;
  hashtags: string[];
  status: string;
  platform?: string | null;
  format?: string | null;
  /** Plateforme résolue côté serveur (couvre AD_VISUAL, EMAIL_MARKETING…). */
  resolvedPlatform?: string | null;
  brand?: { id: string; name: string } | null;
  media?: Array<{ id: string; url: string | null; type?: string | null }> | null;
  approvals?: Array<{ id: string; status: string }> | null;
  metadata?: Record<string, unknown> | null;
}

function localDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Vue focalisée d'UNE publication existante — remplace l'ancienne redirection
 * vers le Studio (9 onglets de création) quand on clique un post depuis la
 * Production ou le Calendrier. Objectif : voir le visuel + le texte, et agir
 * (Valider / Programmer / Publier / Partager) sans quitter le contexte. La
 * création avancée reste accessible via « Éditer dans le Studio ».
 */
export function PostDetail({ postId }: { postId: string }) {
  const router = useRouter();
  const [post, setPost] = useState<PostFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [schedOpen, setSchedOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/posts/${postId}`, { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      setPost((j?.data ?? null) as PostFull | null);
    }
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setScheduleAt((p) => p || localDatetime(new Date(Date.now() + 60 * 60 * 1000)));
  }, []);

  // Tous les visuels disponibles (les générations successives s'accumulent —
  // un post en comptait 83). Un seul est PUBLIÉ : celui sélectionné.
  const visuals = useMemo(
    () => (post?.media ?? []).filter((m) => (m?.url ?? '').length > 0),
    [post],
  );
  const selectedMediaId = useMemo(() => {
    const meta = (post?.metadata ?? null) as Record<string, unknown> | null;
    const fromMeta = typeof meta?.coverMediaId === 'string' ? meta.coverMediaId : null;
    if (fromMeta && visuals.some((m) => m.id === fromMeta)) return fromMeta;
    // Défaut : le dernier attaché (cohérent avec la règle de publication).
    return visuals.length > 0 ? visuals[visuals.length - 1].id : null;
  }, [post, visuals]);
  const selectedVisual = visuals.find((m) => m.id === selectedMediaId) ?? null;
  // Plateforme du post pour contextualiser l'ouverture du Studio : résolue
  // côté serveur (couvre AD_VISUAL…), sinon dérivée du format.
  const studioPlatform = post ? (post.resolvedPlatform ?? platformFromFormat(post.format)) : null;

  /** Désigne le visuel qui sera réellement publié. */
  const chooseVisual = useCallback(
    async (mediaId: string, url: string | null) => {
      setBusy('cover');
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            metadata: { coverMediaId: mediaId, ...(url ? { coverUrl: url } : {}) },
          }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Visuel sélectionné pour la publication.');
        await load();
      } catch (err) {
        toast.error((err as Error).message.slice(0, 120));
      } finally {
        setBusy(null);
      }
    },
    [postId, load],
  );
  const pendingApprovalId = useMemo(
    () => (post?.approvals ?? []).find((a) => a.status === 'PENDING')?.id ?? null,
    [post],
  );
  const statusMeta = post ? postStatusMeta(post.status) : null;
  // `Post` ne stocke que `format` : on déduit la plateforme pour l'affichage et
  // les actions (publier/programmer).
  const platform = post
    ? post.resolvedPlatform ?? post.platform ?? platformFromFormat(post.format)
    : null;

  async function patch(body: Record<string, unknown>, okMsg: string, key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success(okMsg);
      await load();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }

  const saveCaption = () => patch({ body: draft }, 'Texte enregistré', 'caption').then(() => setEditing(false));

  const approve = useCallback(async () => {
    setBusy('approve');
    try {
      // Audit trail si une demande de validation existe, sinon transition directe.
      if (pendingApprovalId) {
        const res = await fetch(`/api/approvals/${pendingApprovalId}/approve`, { method: 'POST' });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
      } else {
        const res = await fetch(`/api/posts/${postId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'APPROVED' }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
      }
      toast.success('Publication validée');
      await load();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [pendingApprovalId, postId, load]);

  const schedule = useCallback(async () => {
    const at = new Date(scheduleAt);
    if (Number.isNaN(at.getTime())) return toast.error('Date invalide');
    setBusy('schedule');
    try {
      const res = await fetch(`/api/posts/${postId}/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          schedulePostInput.parse({ scheduledFor: at.toISOString(), platform: platform ?? undefined }),
        ),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const j = (await res.json().catch(() => null)) as { data?: { mode?: string } } | null;
      toast.success(
        j?.data?.mode === 'MANUAL'
          ? `Programmé — en partage manuel (aucun compte ${platform ?? ''} connecté)`
          : `Programmé pour ${at.toLocaleString()}`,
      );
      setSchedOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [scheduleAt, postId, platform, load]);

  const publish = useCallback(async () => {
    setBusy('publish');
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(publishPostInput.parse({ platform: platform ?? undefined })),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const j = (await res.json().catch(() => null)) as { data?: { mode?: string; message?: string } } | null;
      if (j?.data?.mode === 'MANUAL') {
        toast.info(j.data.message ?? 'Aucun compte connecté — publication manuelle requise.');
      } else {
        toast.success('Publié ✓');
      }
      await load();
    } catch (err) {
      toast.error(`Publication échouée : ${(err as Error).message.slice(0, 120)}`);
    } finally {
      setBusy(null);
    }
  }, [postId, platform, load]);

  const unschedule = useCallback(async () => {
    if (!window.confirm('Déprogrammer ? La publication retournera dans « Validés ».')) return;
    setBusy('unschedule');
    try {
      const res = await fetch(`/api/posts/${postId}/unschedule`, { method: 'POST' });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Déprogrammé — retour dans « Validés »');
      await load();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [postId, load]);

  const remove = useCallback(async () => {
    if (!window.confirm('Supprimer définitivement cette publication ?')) return;
    setBusy('delete');
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Publication supprimée');
      router.push('/production');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
      setBusy(null);
    }
  }, [postId, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de la publication…
      </div>
    );
  }
  if (!post) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <p className="text-slate-600">Publication introuvable.</p>
        <Link href="/production" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          ← Retour à la production
        </Link>
      </div>
    );
  }

  const isPublished = ['PUBLISHED', 'SIMULATED'].includes(post.status);
  const isScheduled = post.status === 'SCHEDULED';

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-16">
      {/* En-tête */}
      <div>
        <Link href="/production" className="text-xs text-slate-500 hover:underline">
          <ArrowLeft className="inline h-3 w-3" /> Production
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{post.title ?? 'Publication'}</h1>
          {statusMeta ? <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge> : null}
          {platform ? <Badge variant="info" className="text-[10px]">{platform}</Badge> : null}
          {post.brand ? <span className="text-xs text-slate-500">· {post.brand.name}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Aperçu : visuel + texte */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm">Aperçu de la publication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="space-y-2">
              {visuals.length === 0 ? (
                <div className="flex h-48 items-center justify-center rounded-lg border bg-slate-50 text-sm text-slate-400">
                  Aucun visuel attaché
                </div>
              ) : (
                <>
                  {/* Le visuel qui partira réellement */}
                  <div className="overflow-hidden rounded-lg border bg-slate-50">
                    {selectedVisual?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedVisual.url}
                        alt={post.title ?? 'visuel'}
                        className="max-h-[420px] w-full object-contain"
                      />
                    ) : null}
                  </div>
                  <p className="text-[11px] text-emerald-700">
                    ✓ Ce visuel sera publié
                    {visuals.length > 1 ? ` · ${visuals.length} disponibles` : ''}
                  </p>

                  {/* Pellicule de sélection — évite le mur d'images */}
                  {visuals.length > 1 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {visuals.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          title="Utiliser ce visuel"
                          disabled={busy !== null}
                          onClick={() => chooseVisual(m.id, m.url)}
                          className={
                            'h-16 w-16 shrink-0 overflow-hidden rounded border-2 transition-colors ' +
                            (m.id === selectedMediaId
                              ? 'border-emerald-500'
                              : 'border-transparent hover:border-slate-300')
                          }
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.url ?? ''} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="space-y-1 border-t pt-3">
              <p className="text-xs font-medium text-slate-700">Joindre un visuel</p>
              <AttachVisual postId={postId} replace={false} onAttached={() => load()} />
            </div>

            {editing ? (
              <div className="space-y-2">
                <SocialTextEditor rows={6} value={draft} onChange={setDraft} />
                <div className="flex gap-2">
                  <Button size="sm" variant="brand" onClick={saveCaption} disabled={busy === 'caption'}>
                    {busy === 'caption' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Enregistrer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {post.body || <span className="italic text-slate-400">Pas de texte.</span>}
                </p>
                {post.hashtags?.length ? (
                  <p className="text-xs font-medium text-sky-600">{post.hashtags.slice(0, 8).join(' ')}</p>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(post.body ?? '');
                    setEditing(true);
                  }}
                >
                  <Pencil className="mr-1 h-3 w-3" /> Modifier le texte
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card className="h-fit">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-4">
            {post.status === 'PENDING_APPROVAL' ? (
              <>
                <Button className="w-full" variant="brand" onClick={approve} disabled={busy !== null}>
                  {busy === 'approve' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                  Valider la publication
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => patch({ status: 'DRAFT' }, 'Renvoyé en brouillon', 'draft')}
                  disabled={busy !== null}
                >
                  <RotateCcw className="mr-1 h-4 w-4" /> Renvoyer en brouillon
                </Button>
                <div className="my-1 border-t" />
              </>
            ) : null}

            {!isPublished ? (
              <>
                <Button className="w-full" variant="outline" onClick={() => setSchedOpen((v) => !v)} disabled={busy !== null}>
                  <Calendar className="mr-1 h-4 w-4" /> {isScheduled ? 'Reprogrammer' : 'Programmer'}
                </Button>
                {isScheduled ? (
                  <Button className="w-full" variant="ghost" onClick={unschedule} disabled={busy !== null}>
                    {busy === 'unschedule' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CalendarOff className="mr-1 h-4 w-4" />}
                    Déprogrammer
                  </Button>
                ) : null}
                {schedOpen ? (
                  <div className="rounded-md border bg-slate-50 p-2">
                    <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="text-xs" />
                    <Button size="sm" variant="brand" className="mt-2 w-full" onClick={schedule} disabled={busy === 'schedule'}>
                      {busy === 'schedule' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                      Confirmer
                    </Button>
                  </div>
                ) : null}
                <Button className="w-full" variant="brand" onClick={publish} disabled={busy !== null}>
                  {busy === 'publish' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                  Publier maintenant
                </Button>
                <Button className="w-full" variant="outline" onClick={() => setShareOpen(true)} disabled={busy !== null}>
                  <Share2 className="mr-1 h-4 w-4" /> Partager manuellement
                </Button>
              </>
            ) : (
              <p className="rounded-md bg-emerald-50 p-2 text-center text-xs text-emerald-700">
                Cette publication est {statusMeta?.label.toLowerCase()}.
              </p>
            )}

            <div className="my-1 border-t" />
            <Link href={`/studio?postId=${post.id}&tab=texte${studioPlatform ? `&platform=${studioPlatform}` : ''}`}>
              <Button className="w-full" variant="ghost" size="sm">
                <ExternalLink className="mr-1 h-3 w-3" /> Édition avancée dans le Studio
              </Button>
            </Link>
            {post.status !== 'PUBLISHING' ? (
              <Button
                className="w-full text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                variant="ghost"
                size="sm"
                onClick={remove}
                disabled={busy !== null}
              >
                {busy === 'delete' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                Supprimer
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ManualShareDialog postId={post.id} open={shareOpen} onClose={() => setShareOpen(false)} onShared={load} />
    </div>
  );
}

export default PostDetail;
