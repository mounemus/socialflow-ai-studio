'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Pencil, ExternalLink, Trash2, Clapperboard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SocialTextEditor } from '@/components/ui/social-text-editor';
import { AttachVisual } from '@/components/media/AttachVisual';
import { PublishActions, type PublishablePost } from '@/components/publish/PublishActions';
import { apiErrorMessage } from '@/lib/client-api-error';
import { postStatusMeta, platformFromFormat } from '@/lib/post-status';
import { isVideoFormat, isVideoMedia } from '@/lib/media-kind';

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
  media?: Array<{ id: string; url: string | null; kind?: string | null; mimeType?: string | null }> | null;
  approvals?: Array<{ id: string; status: string }> | null;
  schedules?: Array<{ id: string; status: string; errorMessage?: string | null }> | null;
  metadata?: Record<string, unknown> | null;
  destination?: PublishablePost['destination'];
  requireApproval?: boolean;
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
  // Incrustation du logo de marque sur le visuel sélectionné.
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoParams, setLogoParams] = useState({
    position: 'bottom-right',
    sizePct: 14,
    opacity: 90,
    marginPct: 3,
  });

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

  // Tous les visuels disponibles (les générations successives s'accumulent —
  // un post en comptait 83). Un seul est PUBLIÉ : celui sélectionné.
  const visuals = useMemo(
    () => (post?.media ?? []).filter((m) => (m?.url ?? '').length > 0),
    [post],
  );
  const selectedMediaId = useMemo(() => {
    // Même règle que publishableMediaUrls : format vidéo → la dernière vidéo
    // attachée part, quelle que soit la couverture image.
    if (isVideoFormat(post?.format)) {
      const video = [...visuals].reverse().find((m) => isVideoMedia(m));
      if (video) return video.id;
    }
    const meta = (post?.metadata ?? null) as Record<string, unknown> | null;
    const fromMeta = typeof meta?.coverMediaId === 'string' ? meta.coverMediaId : null;
    if (fromMeta && visuals.some((m) => m.id === fromMeta)) return fromMeta;
    // Défaut : le dernier attaché (cohérent avec la règle de publication).
    return visuals.length > 0 ? visuals[visuals.length - 1].id : null;
  }, [post, visuals]);
  const selectedVisual = visuals.find((m) => m.id === selectedMediaId) ?? null;
  const selectedIsVideo = !!selectedVisual && isVideoMedia(selectedVisual);
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
  /** Incruste le logo de la marque sur le visuel sélectionné (nouveau visuel, l'original est conservé). */
  const applyBrandLogo = useCallback(async () => {
    setBusy('logo');
    try {
      const res = await fetch(`/api/posts/${postId}/brand-logo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(selectedMediaId ? { mediaId: selectedMediaId } : {}),
          ...logoParams,
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Logo incrusté — le visuel marqué est sélectionné pour la publication.');
      setLogoOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setBusy(null);
    }
  }, [postId, selectedMediaId, logoParams, load]);

  const statusMeta = post ? postStatusMeta(post.status) : null;
  // `Post` ne stocke que `format` : on déduit la plateforme pour l'affichage.
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
                  <div className="flex justify-center overflow-hidden rounded-lg border bg-slate-50">
                    {selectedVisual?.url && selectedIsVideo ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={selectedVisual.url} controls playsInline className="block max-h-[420px] max-w-full" />
                    ) : selectedVisual?.url ? (
                      // Wrapper ajusté à l'image (pas de letterbox) : l'overlay
                      // logo en % reste aligné sur le visuel réel. `cqw` = % de
                      // la largeur du visuel, comme logoPlacement côté serveur.
                      <div className="relative inline-block" style={{ containerType: 'inline-size' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedVisual.url}
                          alt={post.title ?? 'visuel'}
                          className="block max-h-[420px] max-w-full"
                        />
                        {logoOpen && post.brand ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/posts/${postId}/brand-logo`}
                            alt=""
                            className="pointer-events-none absolute"
                            style={{
                              width: `${logoParams.sizePct}%`,
                              opacity: logoParams.opacity / 100,
                              ...(logoParams.position === 'center'
                                ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
                                : {
                                    [logoParams.position.startsWith('top') ? 'top' : 'bottom']: `${logoParams.marginPct}cqw`,
                                    [logoParams.position.endsWith('left') ? 'left' : 'right']: `${logoParams.marginPct}cqw`,
                                  }),
                            }}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-emerald-700">
                    ✓ {selectedIsVideo ? 'Cette vidéo sera publiée' : 'Ce visuel sera publié'}
                    {visuals.length > 1 ? ` · ${visuals.length} disponibles` : ''}
                    {isVideoFormat(post.format) && !selectedIsVideo
                      ? ' · format vidéo sans vidéo attachée — génère-la dans le Studio (Vidéo/Reel)'
                      : ''}
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
                          {isVideoMedia(m) ? (
                            <span className="flex h-full w-full items-center justify-center bg-slate-900 text-white">
                              <Clapperboard className="h-5 w-5" />
                            </span>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.url ?? ''} alt="" className="h-full w-full object-cover" />
                          )}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Logo de marque sur le visuel sélectionné — paramétrage avancé */}
            {post.brand && selectedVisual && !selectedIsVideo ? (
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-700">Logo de marque</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => setLogoOpen((v) => !v)}
                    disabled={busy !== null}
                  >
                    {logoOpen ? 'Fermer' : 'Ajouter le logo au visuel'}
                  </Button>
                </div>
                {logoOpen ? (
                  <div className="space-y-2 rounded-md border bg-slate-50 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-[11px] text-slate-600">
                        Position
                        <select
                          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                          value={logoParams.position}
                          onChange={(e) => setLogoParams((p) => ({ ...p, position: e.target.value }))}
                        >
                          <option value="bottom-right">Bas droite</option>
                          <option value="bottom-left">Bas gauche</option>
                          <option value="top-right">Haut droite</option>
                          <option value="top-left">Haut gauche</option>
                          <option value="center">Centre (filigrane)</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-[11px] text-slate-600">
                        Taille — {logoParams.sizePct}% de la largeur
                        <input
                          type="range" min={5} max={40} step={1}
                          className="w-full"
                          value={logoParams.sizePct}
                          onChange={(e) => setLogoParams((p) => ({ ...p, sizePct: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1 text-[11px] text-slate-600">
                        Opacité — {logoParams.opacity}%
                        <input
                          type="range" min={10} max={100} step={5}
                          className="w-full"
                          value={logoParams.opacity}
                          onChange={(e) => setLogoParams((p) => ({ ...p, opacity: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="space-y-1 text-[11px] text-slate-600">
                        Marge — {logoParams.marginPct}%
                        <input
                          type="range" min={0} max={10} step={1}
                          className="w-full"
                          value={logoParams.marginPct}
                          onChange={(e) => setLogoParams((p) => ({ ...p, marginPct: Number(e.target.value) }))}
                        />
                      </label>
                    </div>
                    <Button size="sm" variant="brand" className="w-full" onClick={applyBrandLogo} disabled={busy !== null}>
                      {busy === 'logo' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                      Appliquer le logo
                    </Button>
                    <p className="text-[10px] text-slate-500">
                      Crée un nouveau visuel marqué et le sélectionne pour la publication — l&apos;original reste dans la pellicule.
                      Le logo vient de la fiche marque (Configuration → Marques).
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

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
            <PublishActions post={post} onChanged={load} />

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

    </div>
  );
}

export default PostDetail;
