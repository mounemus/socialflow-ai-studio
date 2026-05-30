'use client';

import * as React from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, Share2, MoreVertical, Play } from 'lucide-react';
import { BasePreviewProps, BrandAvatar, handleOf } from './_shared';

export function YouTubeShortPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
  videoUrl,
  cta,
}: BasePreviewProps) {
  const title = caption || cta || 'Short';
  const titleTrim = title.length > 80 ? title.slice(0, 80).trimEnd() + '…' : title;

  return (
    <div className="relative w-full max-w-[280px] mx-auto aspect-[9/16] bg-black rounded-xl overflow-hidden text-white shadow-lg">
      {videoUrl ? (
        <video
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
        />
      ) : imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
          Short
        </div>
      )}

      {/* Top */}
      <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[13px] font-semibold">
        <span>Shorts</span>
        <MoreVertical className="w-5 h-5" />
      </div>

      {/* Big play button overlay */}
      <button
        type="button"
        className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-red-600/90 hover:bg-red-600 flex items-center justify-center shadow-lg"
        aria-label="Lire"
      >
        <Play className="w-7 h-7 ml-0.5 fill-white text-white" />
      </button>

      {/* Side actions */}
      <div className="absolute right-2 bottom-28 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center">
          <ThumbsUp className="w-7 h-7" />
          <span className="text-[11px] mt-0.5">42k</span>
        </div>
        <div className="flex flex-col items-center">
          <ThumbsDown className="w-7 h-7" />
          <span className="text-[11px] mt-0.5">Je n'aime pas</span>
        </div>
        <div className="flex flex-col items-center">
          <MessageSquare className="w-7 h-7" />
          <span className="text-[11px] mt-0.5">1,2k</span>
        </div>
        <div className="flex flex-col items-center">
          <Share2 className="w-7 h-7" />
          <span className="text-[11px] mt-0.5">Partager</span>
        </div>
      </div>

      {/* Bottom */}
      <div className="absolute inset-x-0 bottom-0 px-3 pt-12 pb-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
        <div className="flex items-center gap-2 mb-2">
          <BrandAvatar brand={brand} size={28} />
          <span className="font-semibold text-[13px]">@{handleOf(brand)}</span>
          <button
            type="button"
            className="ml-1 bg-red-600 hover:bg-red-700 text-white text-[12px] font-semibold rounded-full px-3 py-1"
          >
            S'abonner
          </button>
        </div>
        <div className="text-[13px] leading-snug line-clamp-2">{titleTrim}</div>
        {hashtags && hashtags.length > 0 && (
          <div className="text-[11px] text-blue-300 mt-0.5">
            {hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}
          </div>
        )}
      </div>
    </div>
  );
}

export default YouTubeShortPreview;
