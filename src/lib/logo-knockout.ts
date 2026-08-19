import sharp from 'sharp';

/**
 * Rend transparent le fond blanc OPAQUE d'un logo (JPEG, PNG plein) : remplissage
 * depuis les bords, donc les blancs intérieurs du logo sont conservés. Ne touche
 * pas un logo dont les coins sont déjà transparents ou colorés.
 */
export async function knockoutWhiteBackground(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isWhite = (i: number) => data[i + 3] > 0 && data[i] >= 235 && data[i + 1] >= 235 && data[i + 2] >= 235;
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  if (!corners.every((p) => isWhite(p * 4))) return png;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p] || !isWhite(p * 4)) continue;
    seen[p] = 1;
    data[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p + w < w * h) stack.push(p + w);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Logo prêt à incruster : redimensionné à `width`, alpha garanti, fond blanc détouré. */
export async function prepareLogo(logoBuf: Buffer, width: number): Promise<Buffer> {
  const resized = await sharp(logoBuf).resize({ width }).ensureAlpha().png().toBuffer();
  return knockoutWhiteBackground(resized);
}
