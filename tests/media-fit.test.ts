import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fitImage } from '@/lib/media-fit';

async function solid(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#3355aa' } }).png().toBuffer();
}

describe('media-fit — gabarit Instagram', () => {
  it('recadre un 9:16 (0.56) en 4:5 sans bandes', async () => {
    const out = await fitImage(await solid(900, 1600), 'instagram');
    expect(out).not.toBeNull();
    const m = await sharp(out!.bytes).metadata();
    expect(m.width).toBe(900);
    expect(m.height).toBe(1125); // 900 / 0.8
    expect(out!.contentType).toBe('image/jpeg');
  });

  it('recadre un panoramique trop large (2.5) en 1.91:1', async () => {
    const out = await fitImage(await solid(2500, 1000), 'instagram');
    expect(out).not.toBeNull();
    const m = await sharp(out!.bytes).metadata();
    expect(m.height).toBe(1000);
    expect(m.width).toBe(1910);
  });

  it('laisse intact un 4:5 ou un carré (déjà conformes)', async () => {
    expect(await fitImage(await solid(1080, 1350), 'instagram')).toBeNull();
    expect(await fitImage(await solid(1080, 1080), 'instagram')).toBeNull();
  });
});
