'use client';

import * as React from 'react';
import { Star, Reply, ReplyAll, Forward, MoreHorizontal } from 'lucide-react';
import { BasePreviewProps, BrandAvatar, handleOf } from './_shared';

interface EmailProps extends BasePreviewProps {
  subject?: string;
  body?: string;
  preheader?: string;
}

export function EmailPreview({
  brand,
  caption,
  cta,
  imageUrl,
  subject,
  body,
  preheader,
}: EmailProps) {
  const handle = handleOf(brand);
  const finalSubject = subject || caption?.split('\n')[0] || 'Votre nouvelle annonce';
  const bodyText = body || caption || '';

  return (
    <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-lg overflow-hidden text-[13px] text-gray-900 shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 text-gray-500">
          <Reply className="w-4 h-4" />
          <ReplyAll className="w-4 h-4" />
          <Forward className="w-4 h-4" />
        </div>
        <MoreHorizontal className="w-4 h-4 text-gray-500" />
      </div>

      {/* Subject */}
      <div className="px-3 pt-3 pb-1">
        <div className="text-[16px] font-semibold leading-tight">{finalSubject}</div>
        {preheader && (
          <div className="text-[12px] text-gray-500 mt-0.5 truncate">{preheader}</div>
        )}
      </div>

      {/* Sender row */}
      <div className="px-3 py-2 flex items-start gap-2 border-b border-gray-100">
        <BrandAvatar brand={brand} size={32} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-[13px]">
              <span className="font-semibold">{brand.name}</span>{' '}
              <span className="text-gray-500">
                &lt;hello@{handle}.com&gt;
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span>10:24</span>
              <Star className="w-4 h-4" />
            </div>
          </div>
          <div className="text-[11px] text-gray-500">À : moi</div>
        </div>
      </div>

      {/* Hero image */}
      {imageUrl && (
        <div className="w-full bg-gray-100">
          <img src={imageUrl} alt="" className="w-full aspect-[2/1] object-cover" />
        </div>
      )}

      {/* Body */}
      <div className="px-4 py-4 text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap">
        <p className="mb-3">Bonjour,</p>
        <p className="mb-3">{bodyText}</p>
        <p className="mb-4">— L'équipe {brand.name}</p>

        {cta && (
          <div className="text-center my-4">
            <button
              type="button"
              className="inline-block rounded-md px-5 py-2.5 text-white text-[13px] font-semibold shadow-sm"
              style={{ background: brand.primaryColor || '#2563eb' }}
            >
              {cta}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 text-[10px] text-gray-400 text-center leading-snug border-t border-gray-100 pt-3">
        Vous recevez cet email car vous êtes abonné à {brand.name}.
        <br />
        <span className="underline">Se désinscrire</span> ·{' '}
        <span className="underline">Préférences</span>
      </div>
    </div>
  );
}

export default EmailPreview;
