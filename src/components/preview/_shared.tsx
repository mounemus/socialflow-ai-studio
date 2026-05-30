/**
 * Shared types & helpers for platform preview mockups.
 */
import * as React from 'react';

export interface BasePreviewProps {
  brand: BrandLike;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface BrandLike {
  name: string;
  handle?: string;
  logoUrl?: string;
  primaryColor?: string;
}

/** Initial circle avatar fallback when no logo provided. */
export function BrandAvatar({
  brand,
  size = 32,
  className = '',
}: {
  brand: BrandLike;
  size?: number;
  className?: string;
}) {
  const initial = (brand.name || brand.handle || '?').trim().charAt(0).toUpperCase();
  const bg = brand.primaryColor || '#6366f1';
  if (brand.logoUrl) {
    return (
      <img
        src={brand.logoUrl}
        alt={brand.name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-full text-white font-semibold ${className}`}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}

/** Returns handle without leading "@". */
export function handleOf(brand: BrandLike): string {
  const raw = brand.handle || brand.name || 'brand';
  return raw.replace(/^@/, '').toLowerCase().replace(/\s+/g, '');
}

/** Truncate caption with optional "Voir plus" affordance. */
export function useTruncate(text: string | undefined, max: number) {
  const safe = text || '';
  const isLong = safe.length > max;
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded || !isLong ? safe : safe.slice(0, max).trimEnd() + '…';
  return { shown, isLong, expanded, setExpanded };
}

/** Format hashtag tokens, removing any leading '#'. */
export function normalizeHashtags(tags?: string[]): string[] {
  if (!tags) return [];
  return tags
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
}

/** A consistent fake "il y a 2 h" timestamp for previews. */
export function fakeTime(): string {
  return 'il y a 2 h';
}

/** Caption text with @brand handle highlighted + hashtags in blue. */
export function CaptionText({
  brand,
  caption,
  hashtags,
  className = '',
  hashtagColor = 'text-blue-600',
}: {
  brand: BrandLike;
  caption?: string;
  hashtags?: string[];
  className?: string;
  hashtagColor?: string;
}) {
  const handle = handleOf(brand);
  const tags = normalizeHashtags(hashtags);
  return (
    <span className={className}>
      <span className={`font-semibold mr-1`}>@{handle}</span>
      {caption}
      {tags.length > 0 && (
        <>
          {' '}
          <span className={hashtagColor}>{tags.join(' ')}</span>
        </>
      )}
    </span>
  );
}
