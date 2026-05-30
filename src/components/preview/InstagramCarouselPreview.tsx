'use client';

import * as React from 'react';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  BasePreviewProps,
  BrandAvatar,
  CaptionText,
  handleOf,
  useTruncate,
  fakeTime,
} from './_shared';

interface CarouselProps extends Omit<BasePreviewProps, 'imageUrl'> {
  imageUrl?: string;
  imageUrls?: string[];
}

export function InstagramCarouselPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
  imageUrls,
}: CarouselProps) {
  const slides = (imageUrls && imageUrls.length > 0
    ? imageUrls
    : imageUrl
    ? [imageUrl]
    : []) as string[];
  const [idx, setIdx] = React.useState(0);
  const count = Math.max(slides.length, 1);
  const { shown, isLong, expanded, setExpanded } = useTruncate(caption, 90);

  const prev = () => setIdx((i) => (i - 1 + count) % count);
  const next = () => setIdx((i) => (i + 1) % count);

  return (
    <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-md overflow-hidden text-[13px] text-gray-900 shadow-sm">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <BrandAvatar brand={brand} size={32} />
          <span className="font-semibold">{handleOf(brand)}</span>
        </div>
        <MoreHorizontal className="w-5 h-5 text-gray-700" />
      </div>

      {/* Image carousel */}
      <div className="relative aspect-square w-full bg-gray-100">
        {slides.length > 0 ? (
          <img src={slides[idx]} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
            Carrousel
          </div>
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 hover:bg-white shadow flex items-center justify-center"
              aria-label="Précédent"
            >
              <ChevronLeft className="w-4 h-4 text-gray-700" />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 hover:bg-white shadow flex items-center justify-center"
              aria-label="Suivant"
            >
              <ChevronRight className="w-4 h-4 text-gray-700" />
            </button>
            <div className="absolute top-2 right-2 text-[11px] bg-black/60 text-white rounded-full px-2 py-0.5">
              {idx + 1}/{count}
            </div>
          </>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="flex items-center gap-3">
          <Heart className="w-6 h-6" />
          <MessageCircle className="w-6 h-6" />
          <Send className="w-6 h-6" />
        </div>
        <Bookmark className="w-6 h-6" />
      </div>

      {/* Dots */}
      {count > 1 && (
        <div className="flex items-center justify-center gap-1 py-2">
          {Array.from({ length: count }).map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all ${
                i === idx ? 'w-2 h-2 bg-blue-500' : 'w-1.5 h-1.5 bg-gray-300'
              }`}
            />
          ))}
        </div>
      )}

      <div className="px-3 pt-1 text-[13px] font-semibold">894 mentions J'aime</div>
      <div className="px-3 pt-1 text-[13px] leading-snug">
        <CaptionText brand={brand} caption={shown} hashtags={hashtags} />
        {isLong && !expanded && (
          <>
            {' '}
            <button
              className="text-gray-500"
              type="button"
              onClick={() => setExpanded(true)}
            >
              Voir plus
            </button>
          </>
        )}
      </div>
      <div className="px-3 pt-1 pb-3 text-[11px] uppercase text-gray-400">{fakeTime()}</div>
    </div>
  );
}

export default InstagramCarouselPreview;
