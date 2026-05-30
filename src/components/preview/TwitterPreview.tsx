'use client';

import * as React from 'react';
import {
  MessageCircle,
  Repeat2,
  Heart,
  BarChart3,
  Bookmark,
  Upload,
  MoreHorizontal,
  BadgeCheck,
} from 'lucide-react';
import { BasePreviewProps, BrandAvatar, handleOf, normalizeHashtags } from './_shared';

const TWITTER_LIMIT = 280;

export function TwitterPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
}: BasePreviewProps) {
  const tags = normalizeHashtags(hashtags);
  const fullText = [caption || '', tags.join(' ')].join(' ').trim();
  const overLimit = fullText.length > TWITTER_LIMIT;
  const truncated = overLimit ? fullText.slice(0, TWITTER_LIMIT - 1) + '…' : fullText;

  return (
    <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-2xl overflow-hidden text-[14px] text-gray-900 shadow-sm">
      <div className="px-3 pt-3">
        <div className="flex items-start gap-3">
          <BrandAvatar brand={brand} size={40} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap text-[14px]">
              <span className="font-bold leading-tight">{brand.name}</span>
              <BadgeCheck className="w-4 h-4 text-blue-500" />
              <span className="text-gray-500 leading-tight">@{handleOf(brand)}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-500">2 h</span>
            </div>
            <div className="mt-1 whitespace-pre-wrap text-[14px] leading-snug">
              {truncated.split(/(\s+)/).map((tok, i) => {
                if (tok.startsWith('#')) return <span key={i} className="text-blue-500">{tok}</span>;
                if (tok.startsWith('@')) return <span key={i} className="text-blue-500">{tok}</span>;
                return <React.Fragment key={i}>{tok}</React.Fragment>;
              })}
            </div>
            {overLimit && (
              <div className="mt-1 text-[11px] text-red-500">
                Dépasse la limite ({fullText.length}/{TWITTER_LIMIT})
              </div>
            )}
          </div>
          <MoreHorizontal className="w-4 h-4 text-gray-500 shrink-0" />
        </div>

        {/* Image */}
        {imageUrl && (
          <div className="mt-2 ml-[52px] rounded-2xl overflow-hidden border border-gray-200">
            <img src={imageUrl} alt="" className="w-full aspect-[16/9] object-cover" />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-2 mt-1 ml-[52px] mr-3 flex items-center justify-between text-gray-500 text-[12px]">
        <button className="flex items-center gap-1 hover:text-blue-500">
          <MessageCircle className="w-4 h-4" />
          <span>42</span>
        </button>
        <button className="flex items-center gap-1 hover:text-green-500">
          <Repeat2 className="w-4 h-4" />
          <span>18</span>
        </button>
        <button className="flex items-center gap-1 hover:text-pink-500">
          <Heart className="w-4 h-4" />
          <span>312</span>
        </button>
        <button className="flex items-center gap-1 hover:text-blue-500">
          <BarChart3 className="w-4 h-4" />
          <span>8,2k</span>
        </button>
        <div className="flex items-center gap-3">
          <Bookmark className="w-4 h-4" />
          <Upload className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

export default TwitterPreview;
