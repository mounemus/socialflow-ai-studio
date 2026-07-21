'use client';
import { useState } from 'react';
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
              <Card key={m.id} className="overflow-hidden">
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
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
