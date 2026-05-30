'use client';

import * as React from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal } from 'lucide-react';
import {
  BasePreviewProps,
  BrandAvatar,
  CaptionText,
  handleOf,
  useTruncate,
  fakeTime,
} from './_shared';

export function InstagramPostPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
}: BasePreviewProps) {
  const { shown, isLong, expanded, setExpanded } = useTruncate(caption, 90);
  return (
    <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-md overflow-hidden text-[13px] text-gray-900 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <BrandAvatar brand={brand} size={32} />
          <span className="font-semibold text-[13px]">{handleOf(brand)}</span>
        </div>
        <MoreHorizontal className="w-5 h-5 text-gray-700" />
      </div>

      {/* Image 1:1 */}
      <div className="aspect-square w-full bg-gray-100">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
            Visuel
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="flex items-center gap-3">
          <Heart className="w-6 h-6 text-gray-900" />
          <MessageCircle className="w-6 h-6 text-gray-900" />
          <Send className="w-6 h-6 text-gray-900" />
        </div>
        <Bookmark className="w-6 h-6 text-gray-900" />
      </div>

      {/* Likes */}
      <div className="px-3 pt-1 text-[13px] font-semibold">1 248 mentions J'aime</div>

      {/* Caption */}
      <div className="px-3 pt-1 text-[13px] leading-snug">
        <CaptionText brand={brand} caption={shown} hashtags={hashtags} />
        {isLong && !expanded && (
          <>
            {' '}
            <button
              className="text-gray-500"
              onClick={() => setExpanded(true)}
              type="button"
            >
              Voir plus
            </button>
          </>
        )}
      </div>

      <div className="px-3 pt-1 pb-3 text-[11px] uppercase text-gray-400">
        {fakeTime()}
      </div>
    </div>
  );
}

export default InstagramPostPreview;
