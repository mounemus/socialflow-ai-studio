'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Share2, Download, Copy, Image as ImageIcon, Check, Loader2, X, Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Composeurs web des réseaux.
 *
 * `prefill: true` → le réseau accepte le texte dans l'URL (intent officiel).
 * `prefill: false` → le réseau a supprimé le pré-remplissage (LinkedIn,
 * Facebook) ou n'expose aucun composeur web (Instagram) : on ouvre la page et
 * le texte part dans le presse-papiers, à coller.
 *
 * AUCUN réseau n'autorise l'attachement d'un fichier via une URL : le visuel
 * doit toujours être téléchargé puis ajouté à la main. C'est une limite des
 * plateformes, pas de l'application.
 */
const NETWORK_TARGETS: Array<{
  id: string;
  label: string;
  prefill: boolean;
  url: (text: string) => string;
}> = [
  { id: 'linkedin', label: 'LinkedIn', prefill: false, url: () => 'https://www.linkedin.com/feed/?shareActive=true' },
  { id: 'facebook', label: 'Facebook', prefill: false, url: () => 'https://www.facebook.com/' },
  { id: 'instagram', label: 'Instagram', prefill: false, url: () => 'https://www.instagram.com/' },
  { id: 'x', label: 'X / Twitter', prefill: true, url: (t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}` },
  { id: 'whatsapp', label: 'WhatsApp', prefill: true, url: (t) => `https://wa.me/?text=${encodeURIComponent(t)}` },
  { id: 'telegram', label: 'Telegram', prefill: true, url: (t) => `https://t.me/share/url?url=&text=${encodeURIComponent(t)}` },
  { id: 'reddit', label: 'Reddit', prefill: true, url: (t) => `https://www.reddit.com/submit?title=${encodeURIComponent(t.slice(0, 280))}` },
];

interface PostMedia {
  id: string;
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
}

interface PostForShare {
  id: string;
  title?: string | null;
  body?: string | null;
  hashtags: string[];
  media: PostMedia[];
}

export interface ManualShareDialogProps {
  postId: string;
  open: boolean;
  onClose: () => void;
  onShared?: () => void;
}

export function ManualShareDialog({ postId, open, onClose, onShared }: ManualShareDialogProps) {
  const [loading, setLoading] = useState(false);
  const [post, setPost] = useState<PostForShare | null>(null);
  const [body, setBody] = useState('');
  const [producing, setProducing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // === Load post on open ===
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    fetch(`/api/posts/${postId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (cancel || !data) return;
        const p: PostForShare = {
          id: data.id,
          title: data.title,
          body: data.body,
          hashtags: data.hashtags ?? [],
          media: data.media ?? [],
        };
        setPost(p);
        setBody(p.body ?? '');
      })
      .catch(() => toast.error('Impossible de charger le post'))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [open, postId]);

  // === Close on Escape ===
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`${label} copié`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Copie impossible');
    }
  }, []);

  const fullText = post
    ? [body, post.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')]
        .filter((s) => s && s.trim().length > 0)
        .join('\n\n')
    : '';

  const handleNativeShare = useCallback(async () => {
    if (!post) return;
    const navAny = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof navAny.share === 'function') {
      try {
        await navAny.share({
          title: post.title ?? 'Partage',
          text: fullText,
        });
        toast.success('Partage natif ouvert');
      } catch (err) {
        // user dismissed — silent
        if ((err as Error).name !== 'AbortError') {
          await copyText(fullText, 'Texte');
        }
      }
    } else {
      await copyText(fullText, 'Texte');
    }
  }, [post, fullText, copyText]);

  /**
   * Ouvre le composeur du réseau. Le texte est TOUJOURS copié d'abord : pour
   * les réseaux sans pré-remplissage c'est le seul moyen de le transférer,
   * et pour les autres cela sert de filet si l'intent est tronqué.
   */
  const openNetwork = useCallback(
    async (n: (typeof NETWORK_TARGETS)[number]) => {
      await copyText(fullText, 'Texte');
      window.open(n.url(fullText), '_blank', 'noopener,noreferrer');
      toast.message(
        n.prefill
          ? `${n.label} ouvert — texte pré-rempli. Ajoute le visuel téléchargé.`
          : `${n.label} ouvert — texte copié, colle-le puis ajoute le visuel téléchargé.`,
        { duration: 7000 },
      );
    },
    [fullText, copyText],
  );

  const handleProduce = useCallback(async () => {
    setProducing(true);
    try {
      const res = await fetch(`/api/posts/${postId}/produce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      // ContentProductionService persists MediaAsset rows; refetch the post to pick up
      // the freshly-attached media (we don't trust the response shape to mirror PostMedia).
      const refreshed = await fetch(`/api/posts/${postId}`).then((r) => r.json());
      if (refreshed?.data) {
        setPost({
          id: refreshed.data.id,
          title: refreshed.data.title,
          body: refreshed.data.body,
          hashtags: refreshed.data.hashtags ?? [],
          media: refreshed.data.media ?? [],
        });
      }
      toast.success('Visuels générés');
    } catch (err) {
      toast.error(`Génération échouée: ${(err as Error).message.slice(0, 100)}`);
    } finally {
      setProducing(false);
    }
  }, [postId]);

  const handleMarkShared = useCallback(async () => {
    setMarking(true);
    try {
      const res = await fetch(`/api/posts/${postId}/manual-share`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const { data } = await res.json();
      toast.success(`Marqué comme partagé (${data.updated} programmation${data.updated > 1 ? 's' : ''})`);
      onShared?.();
      onClose();
    } catch (err) {
      toast.error(`Échec: ${(err as Error).message.slice(0, 100)}`);
    } finally {
      setMarking(false);
    }
  }, [postId, onClose, onShared]);

  if (!open) return null;

  const hashtagText = post?.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ') ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <Card className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-orange-600" />
            <CardTitle className="text-lg">Partager manuellement</CardTitle>
            <Badge variant="warning" className="text-[10px]">MANUAL</Badge>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>

        <CardContent className="space-y-4 p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : !post ? (
            <div className="text-sm text-muted-foreground">Post introuvable.</div>
          ) : (
            <>
              {/* === BODY === */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Texte du post
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(body, 'Texte')}
                    disabled={!body}
                  >
                    {copied === 'Texte' ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                    Copier
                  </Button>
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  className="text-sm"
                  placeholder="Corps du post…"
                />
              </div>

              {/* === HASHTAGS === */}
              {post.hashtags.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Hashtags ({post.hashtags.length})
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyText(hashtagText, 'Hashtags')}
                    >
                      {copied === 'Hashtags' ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                      Tout copier
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 rounded-md border bg-slate-50 p-2">
                    {post.hashtags.map((h) => (
                      <Badge key={h} variant="secondary" className="text-[11px]">
                        {h.startsWith('#') ? h : `#${h}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* === VISUALS === */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <ImageIcon className="h-3 w-3" />
                    Visuels ({post.media.length})
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProduce}
                    disabled={producing}
                  >
                    {producing ? (
                      <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Génération…</>
                    ) : (
                      <><Sparkles className="mr-1 h-3 w-3" /> Générer maintenant</>
                    )}
                  </Button>
                </div>
                {post.media.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-slate-50 p-4 text-center text-xs text-muted-foreground">
                    Aucun visuel. Cliquez sur « Générer maintenant » pour en créer.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {post.media.map((m) => (
                      <div key={m.id} className="group relative overflow-hidden rounded-md border bg-slate-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.thumbnailUrl ?? m.url}
                          alt={m.altText ?? ''}
                          className="aspect-square w-full object-cover"
                        />
                        <a
                          href={m.url}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Download className="h-5 w-5" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* === RÉSEAUX === */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Publier sur un réseau
                </label>
                <div className="flex flex-wrap gap-2">
                  {NETWORK_TARGETS.map((n) => (
                    <Button
                      key={n.id}
                      variant="outline"
                      size="sm"
                      onClick={() => openNetwork(n)}
                      title={
                        n.prefill
                          ? `Ouvre ${n.label} avec le texte pré-rempli`
                          : `Ouvre ${n.label} — le texte est copié, à coller dans le composeur`
                      }
                    >
                      {n.label}
                      {n.prefill ? null : (
                        <span className="ml-1 text-[10px] text-amber-600">· à coller</span>
                      )}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Les visuels ne peuvent jamais être pré-attachés par un navigateur :
                  télécharge l’image ci-dessus, puis ajoute-la dans le composeur du réseau.
                  LinkedIn, Facebook et Instagram n’acceptent pas non plus de texte
                  pré-rempli — il est copié dans le presse-papiers, il suffit de le coller.
                </p>
              </div>

              {/* === ACTIONS === */}
              <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={handleNativeShare}
                  className={cn('order-2 sm:order-1')}
                >
                  <Share2 className="mr-1 h-4 w-4" /> Ouvrir le partage natif
                </Button>
                <Button
                  variant="brand"
                  onClick={handleMarkShared}
                  disabled={marking}
                  className="order-1 sm:order-2"
                >
                  {marking ? (
                    <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Marquage…</>
                  ) : (
                    <><Check className="mr-1 h-4 w-4" /> Marquer comme partagé</>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
