import { describe, it, expect } from 'vitest';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';

describe('SupabaseStorageService.sanitizeFilename', () => {
  it('preserves clean filenames', () => {
    expect(SupabaseStorageService.sanitizeFilename('hello.png')).toBe('hello.png');
  });

  it('strips dangerous characters', () => {
    expect(SupabaseStorageService.sanitizeFilename('hello world!@#.png')).toBe('hello_world___.png');
  });

  it('lowercases extension', () => {
    expect(SupabaseStorageService.sanitizeFilename('photo.JPG')).toBe('photo.jpg');
  });

  it('handles no extension', () => {
    expect(SupabaseStorageService.sanitizeFilename('README')).toBe('README');
  });

  it('caps base length at 60 chars', () => {
    const longName = 'a'.repeat(200) + '.png';
    const sanitized = SupabaseStorageService.sanitizeFilename(longName);
    const base = sanitized.replace(/\.png$/, '');
    expect(base.length).toBeLessThanOrEqual(60);
  });

  it('isConfigured returns false without env vars', () => {
    expect(SupabaseStorageService.isConfigured()).toBe(false);
  });

  it('isOurStorageUrl rejects external URLs', () => {
    expect(SupabaseStorageService.isOurStorageUrl('https://evil.com/file.png')).toBe(false);
  });
});
