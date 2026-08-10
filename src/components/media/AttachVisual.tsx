'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Images, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaUploader, type UploadedMedia } from '@/components/ui/media-uploader';
import { apiErrorMessage } from '@/lib/client-api-error';

interface MediaAsset {
  id: string;
  url: string;
  kind?: string;
  mimeType?: string | null;
  altText?: string | null;
}

/**
 * Attache un visuel à une publication — soit importé depuis l'ordinateur
 * (voie MediaUploader → Bibliothèque), soit choisi dans la Bibliothèque
 * existante. Réutilisable dans tous les outils de publication.
 */
export function AttachVisual({
  postId,
  ensurePostId,
  brandId,
  replace = false,
  onAttached,
}: {
  postId?: string | null;
  /** Si pas encore de post (composeur), appelé pour créer/obtenir l'id avant d'attacher. */
  ensurePostId?: () => Promise<string>;
  brandId?: string | null;
  /** true = le visuel attaché remplace les précédents. */
  replace?: boolean;
  onAttached?: (media: { id: string; url: string; kind?: string }) => void;
}) {
  const [showUploader, setShowUploader] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState<MediaAsset[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const attach = useCallback(
    async (media: { id?: string; url: string; kind?: string }) => {
      if (!media.id) {
        toast.error('Média sans identifiant — attache impossible.');
        return;
      }
      const id = postId ?? (await ensurePostId?.());
      if (!id) {
        toast.error("Écris d'abord la publication.");
        return;
      }
      try {
        const res = await fetch(`/api/posts/${id}/media`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mediaId: media.id, replace }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        toast.success('Visuel attaché à la publication');
        onAttached?.({ id: media.id, url: media.url, kind: media.kind });
        setShowUploader(false);
        setShowLibrary(false);
      } catch (err) {
        toast.error((err as Error).message.slice(0, 120));
      }
    },
    [postId, ensurePostId, replace, onAttached],
  );

  const onUploaded = useCallback(
    (media: UploadedMedia) => {
      attach({ id: media.id, url: media.url });
    },
    [attach],
  );

  const openLibrary = useCallback(async () => {
    setShowUploader(false);
    setShowLibrary((v) => !v);
    if (showLibrary) return;
    setLibraryLoading(true);
    try {
      const res = await fetch('/api/media');
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = await res.json();
      setLibrary((json?.data ?? []) as MediaAsset[]);
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setLibraryLoading(false);
    }
  }, [showLibrary]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setShowLibrary(false);
            setShowUploader((v) => !v);
          }}
        >
          <Upload className="mr-1 h-3.5 w-3.5" /> Importer un visuel
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={openLibrary}>
          <Images className="mr-1 h-3.5 w-3.5" /> Bibliothèque
        </Button>
      </div>

      {showUploader ? (
        <MediaUploader
          brandId={brandId ?? undefined}
          accept="image/*,video/*"
          multiple={false}
          maxSizeMB={25}
          onUploaded={onUploaded}
        />
      ) : null}

      {showLibrary ? (
        <div className="max-h-64 overflow-y-auto rounded-md border p-2">
          {libraryLoading ? (
            <p className="p-2 text-xs text-muted-foreground">Chargement…</p>
          ) : library.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              Bibliothèque vide — importe un média d&apos;abord.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {library.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.altText ?? m.mimeType ?? ''}
                  onClick={() => attach({ id: m.id, url: m.url, kind: m.kind })}
                  className="aspect-square overflow-hidden rounded border hover:border-brand-500"
                >
                  {m.kind === 'VIDEO' ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-800 text-white">
                      <Play className="h-4 w-4" />
                      <span className="truncate px-1 text-[9px]">{m.mimeType ?? 'vidéo'}</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.altText ?? ''} className="h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default AttachVisual;
