import { describe, it, expect } from 'vitest';
import { cn, slugify, formatNumber, formatCurrencyCents } from '@/lib/utils';

describe('utils.slugify', () => {
  it('lowercases and replaces special chars', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('Café d\'été')).toBe('cafe-d-ete');
  });

  it('strips diacritics', () => {
    expect(slugify('Niño àêç')).toBe('nino-aec');
  });

  it('handles emoji and unicode', () => {
    expect(slugify('🎉 Party Time 🎊')).toBe('party-time');
  });

  it('caps at 60 chars', () => {
    const long = 'x'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
});

describe('utils.cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
  it('handles conditional classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('dedupes tailwind conflicts via tailwind-merge', () => {
    expect(cn('px-2 px-4')).toBe('px-4');
  });
});

describe('utils.formatNumber', () => {
  it('formats with locale separators', () => {
    expect(formatNumber(1234567, 'fr-FR').replace(/\s/g, ' ')).toContain('234');
  });
});

describe('utils.formatCurrencyCents', () => {
  it('converts cents to euros', () => {
    const out = formatCurrencyCents(2900, 'EUR', 'fr-FR');
    expect(out).toContain('29');
    expect(out).toContain('€');
  });
});
