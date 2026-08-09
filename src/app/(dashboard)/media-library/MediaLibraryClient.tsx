'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, Download, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { MediaUploader, type UploadedMedia } from '@/components/ui/media-uploader';

interface Item {
  id: string;
  url: string;
  kind: string;
  mimeType?: string | null;
  altText?: string | null;
  brand?: { id: string; name: string } | null;
  createdAt: string;
}

export function MediaLibraryClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [preview, setPreview] = useState<Item | null>(null);

  async function onDelete(id: string) {
    if (!window.confirm('Supprimer ce média ?')) return;
    const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json?.message ?? `Échec suppression (${res.status})`);
      return;
    }
    setItems((s) => s.filter((m) => m.id !== id));
    if (preview?.id === id) setPreview(null);
  }

  function onUploaded(media: UploadedMedia) {
    if (!media.id) return;
    setItems((s) => [
      {
        id: media.id!,
        url: media.url,
        kind: media.contentType?.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        mimeType: media.contentType ?? null,
        altText: null,
        brand: null,
        createdAt: new Date().toISOString(),
      },
      ...s,
    ]);
  }

  return (
    <div className="space-y-6">
      <MediaUploader onUploaded={onUploaded} />

      {items.length === 0 ? null : (
        <div>
          <div className="mb-2 text-sm font-medium">{items.length} médias</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((m) => (
              <Card key={m.id} className="group relative overflow-hidden">
                {m.kind === 'IMAGE' ? (
                  // `loading="lazy"` + `decoding="async"` : la grille peut
                  // contenir 100 visuels pleine résolution — sans cela, le
                  // navigateur les téléchargeait tous d'un coup et la page
                  // restait figée pendant plusieurs secondes.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.url}
                    alt={m.altText ?? ''}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : m.kind === 'VIDEO' ? (
                  <video
                    src={m.url}
                    className="aspect-square w-full object-cover"
                    muted
                    playsInline
                    preload="none"
                  />
                ) : (
                  <div className="aspect-square bg-slate-100 flex items-center justify-center text-xs text-muted-foreground">{m.kind}</div>
                )}

                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setPreview(m)}
                    title="Aperçu"
                    className="rounded-md bg-white/90 p-1.5 text-slate-900 hover:bg-white"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <a
                    href={`/api/media/${m.id}/raw`}
                    download
                    title="Télécharger"
                    className="rounded-md bg-white/90 p-1.5 text-slate-900 hover:bg-white"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => onDelete(m.id)}
                    title="Supprimer"
                    className="rounded-md bg-white/90 p-1.5 text-red-600 hover:bg-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            title="Fermer"
            className="absolute right-4 top-4 rounded-md bg-white/90 p-1.5 text-slate-900 hover:bg-white"
          >
            <X className="h-5 w-5" />
          </button>
          {preview.kind === 'IMAGE' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={preview.altText ?? ''}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : preview.kind === 'VIDEO' ? (
            <video
              src={preview.url}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
