'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MediaUploader, type UploadedMedia } from '@/components/ui/media-uploader';
import { apiErrorMessage } from '@/lib/client-api-error';
import { cn } from '@/lib/utils';

interface Slide {
  mediaId?: string;
  url: string;
  title: string;
  body: string;
}

interface PostMedia {
  id: string;
  url: string;
  type?: string;
}

/** Construit les slides initiales : metadata.slides fait autorité, sinon une slide par image du post. */
function deriveSlides(metadata: Record<string, unknown> | null, media: PostMedia[]): Slide[] {
  const raw = (metadata as { slides?: unknown } | null)?.slides;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((entry) => {
      const e = (entry ?? {}) as { mediaId?: string; url?: string; title?: string; body?: string };
      const url = e.url || media.find((m) => m.id === e.mediaId)?.url || '';
      return { mediaId: e.mediaId, url, title: e.title ?? '', body: e.body ?? '' };
    });
  }
  return media
    .filter((m) => (m.type ?? 'IMAGE').toUpperCase().includes('IMAGE'))
    .map((m) => ({ mediaId: m.id, url: m.url, title: '', body: '' }));
}

export function CarouselEditor({
  postId,
  brandId,
  media,
  metadata,
  onChanged,
}: {
  postId: string;
  brandId?: string | null;
  media: PostMedia[];
  metadata: Record<string, unknown> | null;
  onChanged?: () => void;
}) {
  const [slides, setSlides] = useState<Slide[]>(() => deriveSlides(metadata, media));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function updateSlide(idx: number, patch: Partial<Slide>) {
    setSlides((s) => s.map((slide, i) => (i === idx ? { ...slide, ...patch } : slide)));
    setDirty(true);
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= slides.length) return;
    setSlides((s) => {
      const arr = [...s];
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return arr;
    });
    setDirty(true);
  }

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setSlides((s) => {
      const arr = [...s];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
    setDirty(true);
  }

  async function removeSlide(idx: number) {
    const slide = slides[idx];
    if (!confirm('Retirer cette slide du carrousel ?')) return;
    if (slide.mediaId) {
      try {
        const res = await fetch(`/api/posts/${postId}/media`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mediaId: slide.mediaId }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
      } catch (err) {
        toast.error((err as Error).message.slice(0, 120));
        return;
      }
    }
    setSlides((s) => s.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function setCover(slide: Slide) {
    if (!slide.mediaId && !slide.url) return;
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          metadata: { ...(slide.mediaId ? { coverMediaId: slide.mediaId } : {}), coverUrl: slide.url },
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Couverture définie');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    }
  }

  async function handleUploaded(uploaded: UploadedMedia) {
    if (!uploaded.id) {
      toast.error('Import réussi mais média non enregistré en base');
      return;
    }
    try {
      const res = await fetch(`/api/posts/${postId}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaId: uploaded.id, replace: false }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      setSlides((s) => [...s, { mediaId: uploaded.id, url: uploaded.url, title: '', body: '' }]);
      setDirty(true);
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    }
  }

  async function saveSlides() {
    setSaving(true);
    try {
      const payload = slides.map((s) => ({
        ...(s.mediaId ? { mediaId: s.mediaId } : {}),
        url: s.url,
        ...(s.title ? { title: s.title } : {}),
        ...(s.body ? { body: s.body } : {}),
      }));
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { slides: payload } }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Carrousel enregistré');
      setDirty(false);
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="text-xs text-muted-foreground">
        {slides.length} slide{slides.length > 1 ? 's' : ''} — Instagram recommande 3 à 10
      </div>

      <div className="space-y-3">
        {slides.map((slide, idx) => (
          <div
            key={`${slide.mediaId ?? slide.url}-${idx}`}
            draggable
            onDragStart={() => setDragIndex(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) reorder(dragIndex, idx);
              setDragIndex(null);
            }}
            className={cn(
              'flex gap-3 rounded-lg border bg-card p-3 transition-colors',
              dragIndex === idx && 'opacity-50',
            )}
          >
            <div className="relative shrink-0">
              <div className="aspect-square w-24 overflow-hidden rounded-md border bg-slate-50">
                {slide.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slide.url} alt={`Slide ${idx + 1}`} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <span className="absolute -top-2 -left-2 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                Slide {idx + 1}
              </span>
            </div>

            <div className="flex-1 space-y-2">
              <Input
                value={slide.title}
                onChange={(e) => updateSlide(idx, { title: e.target.value })}
                placeholder="Titre"
                className="h-8 text-sm"
              />
              <Textarea
                value={slide.body}
                onChange={(e) => updateSlide(idx, { body: e.target.value })}
                placeholder="Texte"
                rows={3}
                className="text-sm"
              />
            </div>

            <div className="flex shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                title="Monter"
                className="rounded p-1 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === slides.length - 1}
                title="Descendre"
                className="rounded p-1 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCover(slide)}
                title="Définir comme couverture"
                className="rounded p-1 hover:bg-slate-100"
              >
                <Star className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeSlide(idx)}
                title="Supprimer"
                className="rounded p-1 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 text-xs font-medium">Ajouter une slide</div>
        <MediaUploader
          brandId={brandId ?? undefined}
          accept="image/*"
          multiple={false}
          maxSizeMB={10}
          onUploaded={handleUploaded}
        />
      </div>

      <div className="sticky bottom-0 flex justify-end border-t bg-background/95 p-3 backdrop-blur">
        <Button variant="brand" onClick={saveSlides} disabled={!dirty || saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer les slides'}
        </Button>
      </div>
    </div>
  );
}
