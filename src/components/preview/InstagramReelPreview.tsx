'use client';

import * as React from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreVertical, Music2 } from 'lucide-react';
import { BasePreviewProps, BrandAvatar, handleOf, normalizeHashtags } from './_shared';

export function InstagramReelPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
  videoUrl,
}: BasePreviewProps) {
  const tags = normalizeHashtags(hashtags);
  const truncated =
    caption && caption.length > 70 ? caption.slice(0, 70).trimEnd() + '…' : caption || '';

  return (
    <div className="relative w-full max-w-[280px] mx-auto aspect-[9/16] bg-black rounded-xl overflow-hidden text-white shadow-lg">
      {/* Media full bleed */}
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
          Reel
        </div>
      )}

      {/* Top fade */}
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/40 to-transparent" />
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[13px] font-semibold">
        <span>Reels</span>
        <MoreVertical className="w-5 h-5" />
      </div>

      {/* Right action stack */}
      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center">
          <Heart className="w-6 h-6 drop-shadow" />
          <span className="text-[10px] mt-0.5">12,4k</span>
        </div>
        <div className="flex flex-col items-center">
          <MessageCircle className="w-6 h-6 drop-shadow" />
          <span className="text-[10px] mt-0.5">832</span>
        </div>
        <div className="flex flex-col items-center">
          <Send className="w-6 h-6 drop-shadow" />
          <span className="text-[10px] mt-0.5">421</span>
        </div>
        <Bookmark className="w-6 h-6 drop-shadow" />
        <div className="w-8 h-8 rounded-md bg-black/50 flex items-center justify-center border border-white/30">
          <Music2 className="w-4 h-4" />
        </div>
      </div>

      {/* Bottom overlay */}
      <div className="absolute inset-x-0 bottom-0 px-3 pt-10 pb-3 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-2 mb-2">
          <BrandAvatar brand={brand} size={28} className="ring-1 ring-white" />
          <span className="font-semibold text-[13px]">@{handleOf(brand)}</span>
          <button className="ml-2 text-[11px] border border-white/80 rounded px-2 py-0.5">
            Suivre
          </button>
        </div>
        <div className="text-[12px] leading-snug line-clamp-2">
          {truncated}
          {tags.length > 0 && <span className="text-blue-300"> {tags.join(' ')}</span>}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[11px] opacity-80">
          <Music2 className="w-3 h-3" />
          <span>Son original — {handleOf(brand)}</span>
        </div>
      </div>
    </div>
  );
}

export default InstagramReelPreview;
