/**
 * Sert un MediaAsset comme image binaire publique — logique partagée par
 * /api/media/[id]/raw (compat, options en query) et
 * /api/media/[id]/raw/[name] (URL avec extension, ex. `instagram.jpg`).
 *
 * Pourquoi une URL avec extension : Zernio/Instagram valident le fichier à
 * partir de l'URL et du type ; « Failed to validate Instagram image:
 * unrecognized file format » constaté en prod avec `raw?fit=instagram` (pas
 * d'extension) servant du PNG. Instagram n'accepte que le JPEG → pour lui on
 * convertit TOUJOURS en JPEG et l'URL se termine par `.jpg`.
 */
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { fitImage, type FitPreset } from '@/lib/media-fit';

export interface ServeOptions {
  fit?: FitPreset | null;
  /** Convertit en JPEG quel que soit le format source (Instagram). */
  forceJpeg?: boolean;
}

export type ServeResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'bytes'; bytes: Buffer; contentType: string }
  | { kind: 'error'; status: number; code: string };

export async function serveMedia(id: string, opts: ServeOptions = {}): Promise<ServeResult> {
  const asset = await db.mediaAsset.findUnique({ where: { id }, select: { url: true, mimeType: true } });
  if (!asset?.url) return { kind: 'error', status: 404, code: 'NOT_FOUND' };

  const isRemote = /^https?:\/\//i.test(asset.url);
  const transform = !!opts.fit || !!opts.forceJpeg;
  if (isRemote && !transform) return { kind: 'redirect', url: asset.url };

  let bytes: Buffer;
  let contentType: string;
  if (isRemote) {
    const res = await fetch(asset.url);
    if (!res.ok) return { kind: 'error', status: 502, code: 'UPSTREAM_UNAVAILABLE' };
    bytes = Buffer.from(await res.arrayBuffer());
    contentType = res.headers.get('content-type')?.split(';')[0].trim() || asset.mimeType || 'image/png';
  } else {
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(asset.url);
    if (!match) return { kind: 'error', status: 415, code: 'UNSUPPORTED_MEDIA' };
    contentType = match[1] || asset.mimeType || 'image/png';
    bytes = Buffer.from(match[2], 'base64');
  }

  if (transform && contentType.startsWith('image/')) {
    try {
      let changed = false;
      if (opts.fit) {
        const fitted = await fitImage(bytes, opts.fit);
        if (fitted) {
          bytes = fitted.bytes;
          contentType = fitted.contentType;
          changed = true;
        }
      }
      if (opts.forceJpeg && contentType !== 'image/jpeg') {
        // Aplatit la transparence sur blanc (JPEG n'a pas d'alpha).
        bytes = await sharp(bytes, { failOn: 'none' })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90 })
          .toBuffer();
        contentType = 'image/jpeg';
        changed = true;
      }
      if (!changed && isRemote) return { kind: 'redirect', url: asset.url };
    } catch {
      // Transformation impossible : on sert l'original — le réseau tranchera,
      // mais rien n'est cassé.
    }
  }
  return { kind: 'bytes', bytes, contentType };
}

/** Réponse HTTP d'un ServeResult (partagée par les deux routes). */
export function toResponse(r: ServeResult): NextResponse {
  if (r.kind === 'redirect') return NextResponse.redirect(r.url, 302);
  if (r.kind === 'error') return NextResponse.json({ error: r.code }, { status: r.status });
  return new NextResponse(new Uint8Array(r.bytes), {
    status: 200,
    headers: {
      'Content-Type': r.contentType,
      'Content-Length': String(r.bytes.length),
      // Le contenu d'un média est immuable : cache long, y compris côté CDN.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
