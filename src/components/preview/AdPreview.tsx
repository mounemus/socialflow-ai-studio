'use client';

import * as React from 'react';
import { ThumbsUp, MessageSquare, Share2, MoreHorizontal, Globe2 } from 'lucide-react';
import { BasePreviewProps, BrandAvatar, handleOf } from './_shared';

interface AdProps extends BasePreviewProps {
  headline?: string;
  primaryText?: string;
}

export function AdPreview({
  brand,
  caption,
  cta,
  imageUrl,
  headline,
  primaryText,
}: AdProps) {
  const finalHeadline = headline || caption?.split('\n')[0] || 'Découvrez notre offre';
  const finalPrimary = primaryText || caption || '';
  const finalCta = cta || 'En savoir plus';

  return (
    <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-lg overflow-hidden text-[13px] text-gray-900 shadow-sm">
      {/* Header */}
      <div className="px-3 pt-3 flex items-start justify-between">
        <div className="flex items-start gap-2">
          <BrandAvatar brand={brand} size={36} />
          <div>
            <div className="font-semibold text-[13px] leading-tight">{brand.name}</div>
            <div className="text-[11px] text-gray-500 flex items-center gap-1">
              <span>Sponsorisé</span>
              <span>·</span>
              <Globe2 className="w-3 h-3" />
            </div>
          </div>
        </div>
        <MoreHorizontal className="w-5 h-5 text-gray-500" />
      </div>

      {/* Primary text */}
      {finalPrimary && (
        <div className="px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap">
          {finalPrimary}
        </div>
      )}

      {/* Image */}
      <div className="w-full aspect-[1.91/1] bg-gray-100">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
            Visuel sponsorisé
          </div>
        )}
      </div>

      {/* Headline + CTA card */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border-t border-gray-100">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            {handleOf(brand)}.com
          </div>
          <div className="font-semibold text-[14px] leading-tight truncate">
            {finalHeadline}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
          style={{ background: brand.primaryColor || '#1d4ed8' }}
        >
          {finalCta}
        </button>
      </div>

      {/* Reactions */}
      <div className="flex items-center justify-around border-t border-gray-100 py-1 text-gray-600 text-[12px]">
        <button className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50 rounded">
          <ThumbsUp className="w-4 h-4" /> J'aime
        </button>
        <button className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50 rounded">
          <MessageSquare className="w-4 h-4" /> Commenter
        </button>
        <button className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50 rounded">
          <Share2 className="w-4 h-4" /> Partager
        </button>
      </div>
    </div>
  );
}

export default AdPreview;
