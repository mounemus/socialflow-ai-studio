import { describe, it, expect } from 'vitest';
import { logoPlacement, normalizeLogoParams, DEFAULT_LOGO_PARAMS } from '@/lib/logo-overlay';

describe('normalizeLogoParams', () => {
  it('valeurs absentes ou invalides → défauts', () => {
    expect(normalizeLogoParams(undefined)).toEqual(DEFAULT_LOGO_PARAMS);
    expect(normalizeLogoParams({ position: 'diagonal' as never, sizePct: NaN })).toEqual(DEFAULT_LOGO_PARAMS);
  });
  it('borne les valeurs hors limites', () => {
    const p = normalizeLogoParams({ sizePct: 99, opacity: 1, marginPct: 50 });
    expect(p.sizePct).toBe(40);
    expect(p.opacity).toBe(10);
    expect(p.marginPct).toBe(10);
  });
});

describe('logoPlacement', () => {
  const base = { w: 1000, h: 800 };
  it('bas droite avec marge 3% (30px)', () => {
    expect(logoPlacement(base.w, base.h, 140, 70, { position: 'bottom-right', marginPct: 3 }))
      .toEqual({ left: 1000 - 140 - 30, top: 800 - 70 - 30 });
  });
  it('haut gauche', () => {
    expect(logoPlacement(base.w, base.h, 140, 70, { position: 'top-left', marginPct: 3 }))
      .toEqual({ left: 30, top: 30 });
  });
  it('centre', () => {
    expect(logoPlacement(base.w, base.h, 200, 100, { position: 'center', marginPct: 3 }))
      .toEqual({ left: 400, top: 350 });
  });
  it('reste toujours DANS l’image (logo presque aussi grand que la base)', () => {
    const p = logoPlacement(300, 200, 290, 190, { position: 'bottom-right', marginPct: 10 });
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.left + 290).toBeLessThanOrEqual(300);
    expect(p.top + 190).toBeLessThanOrEqual(200);
  });
});
