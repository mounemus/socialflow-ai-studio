import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { knockoutWhiteBackground } from '@/lib/logo-knockout';

/** 20×20 : fond blanc, carré bleu (4..15), trou blanc au centre (8..11). */
async function whiteBgLogo() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } })
    .composite([
      { input: { create: { width: 12, height: 12, channels: 3, background: '#1e40af' } }, left: 4, top: 4 },
      { input: { create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }, left: 8, top: 8 },
    ])
    .png()
    .toBuffer();
}

const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
};

describe('knockoutWhiteBackground', () => {
  it('fond blanc connexe aux bords → transparent, blanc intérieur conservé', async () => {
    const out = await knockoutWhiteBackground(await whiteBgLogo());
    expect(await alphaAt(out, 0, 0)).toBe(0); // coin
    expect(await alphaAt(out, 2, 10)).toBe(0); // bord gauche
    expect(await alphaAt(out, 5, 5)).toBe(255); // bleu
    expect(await alphaAt(out, 9, 9)).toBe(255); // trou blanc intérieur
  });
  it('logo déjà transparent : inchangé', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }, left: 2, top: 2 }])
      .png()
      .toBuffer();
    const out = await knockoutWhiteBackground(png);
    expect(out.equals(png)).toBe(true);
  });
});
