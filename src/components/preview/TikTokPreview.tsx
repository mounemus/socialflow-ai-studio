'use client';

import * as React from 'react';
import { Heart, MessageCircle, Bookmark, Share2, Music2 } from 'lucide-react';
import { BasePreviewProps, BrandAvatar, handleOf, normalizeHashtags } from './_shared';

export function TikTokPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
  videoUrl,
}: BasePreviewProps) {
  const tags = normalizeHashtags(hashtags);
  const truncated =
    caption && caption.length > 80 ? caption.slice(0, 80).trimEnd() + '…' : caption || '';

  return (
    <div className="relative w-full max-w-[280px] mx-auto aspect-[9/16] bg-black rounded-xl overflow-hidden text-white shadow-lg">
      {/* Media */}
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
          TikTok
        </div>
      )}

      {/* Top tabs */}
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute top-3 left-0 right-0 flex items-center justify-center gap-4 text-[13px] font-medium">
        <span className="opacity-70">Abonnés</span>
        <span className="relative font-bold">
          Pour toi
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-white rounded" />
        </span>
      </div>

      {/* Side action stack */}
      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4">
        <div className="relative">
          <BrandAvatar brand={brand} size={40} className="ring-2 ring-white" />
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center text-[14px] leading-none">
            +
          </span>
        </div>
        <div className="flex flex-col items-center">
          <Heart className="w-7 h-7 drop-shadow" />
          <span className="text-[11px] mt-0.5">128,4k</span>
        </div>
        <div className="flex flex-col items-center">
          <MessageCircle className="w-7 h-7 drop-shadow" />
          <span className="text-[11px] mt-0.5">2 412</span>
        </div>
        <div className="flex flex-col items-center">
          <Bookmark className="w-7 h-7 drop-shadow" />
          <span className="text-[11px] mt-0.5">8 932</span>
        </div>
        <div className="flex flex-col items-center">
          <Share2 className="w-7 h-7 drop-shadow" />
          <span className="text-[11px] mt-0.5">Partager</span>
        </div>
        <div className="w-9 h-9 rounded-md bg-black/60 flex items-center justify-center animate-spin-slow border border-white/30">
          <Music2 className="w-4 h-4" />
        </div>
      </div>

      {/* Bottom overlay */}
      <div className="absolute inset-x-0 bottom-0 px-3 pt-12 pb-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
        <div className="font-semibold text-[14px]">@{handleOf(brand)}</div>
        <div className="text-[12px] leading-snug mt-0.5 line-clamp-2">
          {truncated}
          {tags.length > 0 && <span className="text-white/90"> {tags.join(' ')}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[11px] opacity-90">
          <Music2 className="w-3 h-3" />
          <span>Son original — {brand.name}</span>
        </div>
      </div>
    </div>
  );
}

export default TikTokPreview;
