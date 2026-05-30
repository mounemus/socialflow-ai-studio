'use client';

import * as React from 'react';
import {
  ThumbsUp,
  MessageSquare,
  Repeat2,
  Send,
  Globe2,
  MoreHorizontal,
} from 'lucide-react';
import { BasePreviewProps, BrandAvatar, normalizeHashtags, useTruncate } from './_shared';

interface LinkedInProps extends BasePreviewProps {
  headline?: string;
}

export function LinkedInPostPreview({
  brand,
  caption,
  hashtags,
  imageUrl,
  cta,
  headline,
}: LinkedInProps) {
  const { shown, isLong, expanded, setExpanded } = useTruncate(caption, 180);
  const tags = normalizeHashtags(hashtags);

  return (
    <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-lg overflow-hidden text-[13px] text-gray-900 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between px-3 pt-3">
        <div className="flex items-start gap-2">
          <BrandAvatar brand={brand} size={44} />
          <div>
            <div className="font-semibold text-[14px] leading-tight">{brand.name}</div>
            <div className="text-[11px] text-gray-500 leading-tight">
              {headline || `${brand.name} sur LinkedIn`}
            </div>
            <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
              <span>1 j</span>
              <span>•</span>
              <Globe2 className="w-3 h-3" />
            </div>
          </div>
        </div>
        <MoreHorizontal className="w-5 h-5 text-gray-500" />
      </div>

      {/* Body text */}
      <div className="px-3 pt-2 pb-2 text-[13px] leading-snug whitespace-pre-wrap">
        {shown}
        {isLong && !expanded && (
          <>
            …{' '}
            <button
              className="text-gray-600 font-medium"
              type="button"
              onClick={() => setExpanded(true)}
            >
              voir plus
            </button>
          </>
        )}
        {tags.length > 0 && (
          <div className="text-blue-700 mt-1">{tags.join(' ')}</div>
        )}
      </div>

      {/* Image */}
      {imageUrl && (
        <div className="w-full aspect-[1.91/1] bg-gray-100">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* CTA */}
      {cta && (
        <div className="px-3 py-2 border-t border-gray-100">
          <button className="w-full text-[13px] font-semibold text-blue-700 hover:underline text-left">
            {cta} →
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between text-[11px] text-gray-500">
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 rounded-full bg-blue-600 inline-flex items-center justify-center">
            <ThumbsUp className="w-2.5 h-2.5 text-white" />
          </span>
          <span>342</span>
        </div>
        <span>28 commentaires • 12 reposts</span>
      </div>

      {/* Reactions row */}
      <div className="border-t border-gray-100 flex items-center justify-around py-1 text-[12px] text-gray-600">
        <button className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 rounded">
          <ThumbsUp className="w-4 h-4" />
          <span>J'aime</span>
        </button>
        <button className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 rounded">
          <MessageSquare className="w-4 h-4" />
          <span>Commenter</span>
        </button>
        <button className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 rounded">
          <Repeat2 className="w-4 h-4" />
          <span>Republier</span>
        </button>
        <button className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 rounded">
          <Send className="w-4 h-4" />
          <span>Envoyer</span>
        </button>
      </div>
    </div>
  );
}

export default LinkedInPostPreview;
