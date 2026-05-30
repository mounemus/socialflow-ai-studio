'use client';

import * as React from 'react';
import type { SupportFormat } from '@prisma/client';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { BrandLike } from './_shared';
import { InstagramPostPreview } from './InstagramPostPreview';
import { InstagramReelPreview } from './InstagramReelPreview';
import { InstagramCarouselPreview } from './InstagramCarouselPreview';
import { LinkedInPostPreview } from './LinkedInPostPreview';
import { TwitterPreview } from './TwitterPreview';
import { TikTokPreview } from './TikTokPreview';
import { YouTubeShortPreview } from './YouTubeShortPreview';
import { EmailPreview } from './EmailPreview';
import { AdPreview } from './AdPreview';

export interface PreviewRendererProps {
  format: SupportFormat;
  brand: BrandLike;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  imageUrls?: string[];
  videoUrl?: string;
  videoScript?: string;
  emailSubject?: string;
  emailBody?: string;
}

/** Maps Prisma SupportFormat → coarse platform label. */
function platformLabel(format: SupportFormat): string {
  if (String(format).startsWith('INSTAGRAM')) return 'INSTAGRAM';
  if (String(format).startsWith('FACEBOOK')) return 'FACEBOOK';
  if (String(format).startsWith('LINKEDIN')) return 'LINKEDIN';
  if (String(format).startsWith('TWITTER')) return 'TWITTER';
  if (String(format).startsWith('TIKTOK')) return 'TIKTOK';
  if (String(format).startsWith('YOUTUBE')) return 'YOUTUBE';
  if (String(format).startsWith('PINTEREST')) return 'PINTEREST';
  if (
    format === 'EMAIL_MARKETING' ||
    format === 'NEWSLETTER'
  )
    return 'EMAIL';
  if (format === 'AD_VISUAL' || format === 'WEB_BANNER') return 'AD';
  return 'CONTENU';
}

/** Pretty format label e.g. "Reel", "Carrousel". */
function formatPill(format: SupportFormat): string {
  const map: Partial<Record<SupportFormat, string>> = {
    INSTAGRAM_POST: 'Post',
    INSTAGRAM_STORY: 'Story',
    INSTAGRAM_REEL: 'Reel',
    INSTAGRAM_CAROUSEL: 'Carrousel',
    FACEBOOK_POST: 'Post',
    FACEBOOK_STORY: 'Story',
    LINKEDIN_POST: 'Post',
    LINKEDIN_ARTICLE: 'Article',
    TWITTER_POST: 'Tweet',
    TWITTER_THREAD: 'Thread',
    TIKTOK_VIDEO: 'Vidéo',
    YOUTUBE_SHORT: 'Short',
    YOUTUBE_THUMBNAIL: 'Miniature',
    PINTEREST_PIN: 'Pin',
    WEB_BANNER: 'Bannière',
    AD_VISUAL: 'Pub',
    FLYER: 'Flyer',
    POSTER: 'Affiche',
    PRESENTATION: 'Présentation',
    EDUCATIONAL_CAROUSEL: 'Carrousel éducatif',
    PRODUCT_SHEET: 'Fiche produit',
    NEWSLETTER: 'Newsletter',
    EMAIL_MARKETING: 'Email',
    LANDING_COPY: 'Landing',
    VIDEO_SCRIPT: 'Script vidéo',
    STORYBOARD: 'Storyboard',
    VOICEOVER: 'Voix off',
    EDITORIAL_CALENDAR: 'Calendrier',
  };
  return map[format] || String(format);
}

export function PreviewRenderer(props: PreviewRendererProps) {
  const {
    format,
    brand,
    caption,
    hashtags,
    cta,
    imageUrls = [],
    videoUrl,
    emailSubject,
    emailBody,
  } = props;

  const [variantIdx, setVariantIdx] = React.useState(0);
  const safeImages = imageUrls.filter(Boolean);
  const hasMultiple = safeImages.length > 1;
  const currentImage = safeImages[variantIdx] || safeImages[0];

  const platform = platformLabel(format);
  const pill = formatPill(format);

  const previewBase = {
    brand,
    caption,
    hashtags,
    cta,
    imageUrl: currentImage,
    videoUrl,
  };

  function renderBody() {
    switch (format) {
      case 'INSTAGRAM_POST':
      case 'FACEBOOK_POST':
        return <InstagramPostPreview {...previewBase} />;
      case 'INSTAGRAM_STORY':
      case 'FACEBOOK_STORY':
      case 'INSTAGRAM_REEL':
        return <InstagramReelPreview {...previewBase} />;
      case 'INSTAGRAM_CAROUSEL':
      case 'EDUCATIONAL_CAROUSEL':
        return (
          <InstagramCarouselPreview
            brand={brand}
            caption={caption}
            hashtags={hashtags}
            cta={cta}
            imageUrls={safeImages}
            imageUrl={currentImage}
          />
        );
      case 'LINKEDIN_POST':
      case 'LINKEDIN_ARTICLE':
        return <LinkedInPostPreview {...previewBase} />;
      case 'TWITTER_POST':
      case 'TWITTER_THREAD':
        return <TwitterPreview {...previewBase} />;
      case 'TIKTOK_VIDEO':
        return <TikTokPreview {...previewBase} />;
      case 'YOUTUBE_SHORT':
        return <YouTubeShortPreview {...previewBase} />;
      case 'YOUTUBE_THUMBNAIL':
      case 'PINTEREST_PIN':
        // 1:1 / vertical pinboard-style fallback: reuse IG post
        return <InstagramPostPreview {...previewBase} />;
      case 'EMAIL_MARKETING':
      case 'NEWSLETTER':
        return (
          <EmailPreview
            {...previewBase}
            subject={emailSubject}
            body={emailBody || caption}
          />
        );
      case 'AD_VISUAL':
      case 'WEB_BANNER':
      case 'FLYER':
      case 'POSTER':
      case 'PRODUCT_SHEET':
      case 'LANDING_COPY':
        return <AdPreview {...previewBase} />;
      case 'VIDEO_SCRIPT':
      case 'STORYBOARD':
      case 'VOICEOVER':
      case 'PRESENTATION':
      case 'EDITORIAL_CALENDAR':
        return (
          <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-lg p-4 text-[13px] text-gray-700 shadow-sm">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
              {pill}
            </div>
            <div className="font-semibold text-gray-900 mb-2">
              {caption?.split('\n')[0] || 'Document interne'}
            </div>
            <pre className="whitespace-pre-wrap text-[12px] leading-snug text-gray-700">
              {caption || '(Contenu textuel généré)'}
            </pre>
          </div>
        );
      default:
        return <AdPreview {...previewBase} />;
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between text-[12px] text-gray-600 px-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-700">Plateforme : {platform}</span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
            {pill}
          </span>
        </div>
        {hasMultiple && (
          <div className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-[11px] text-gray-500 mr-1">
              Variante {variantIdx + 1}/{safeImages.length}
            </span>
            <button
              type="button"
              onClick={() => setVariantIdx((i) => (i - 1 + safeImages.length) % safeImages.length)}
              className="w-6 h-6 rounded border border-gray-200 hover:bg-gray-50 flex items-center justify-center"
              aria-label="Variante précédente"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setVariantIdx((i) => (i + 1) % safeImages.length)}
              className="w-6 h-6 rounded border border-gray-200 hover:bg-gray-50 flex items-center justify-center"
              aria-label="Variante suivante"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Preview body */}
      <div className="flex items-start justify-center">{renderBody()}</div>
    </div>
  );
}

export default PreviewRenderer;
