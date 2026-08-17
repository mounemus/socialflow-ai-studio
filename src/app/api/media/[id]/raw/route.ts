import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fitImage, isFitPreset } from '@/lib/media-fit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/media/[id]/raw — sert un visuel comme IMAGE binaire, publiquement.
 *
 * Pourquoi : les générateurs OpenAI/Gemini renvoient l'image en base64. Une
 * data URL ne peut pas être transmise à un réseau social (LinkedIn, Meta… ne
 * savent que TÉLÉCHARGER une URL), et le stockage externe n'est pas toujours
 * configuré — les posts partaient donc sans visuel. Cette route donne à chaque
 * média une URL publique stable, que la passerelle peut aller chercher.
 *
 * `?fit=instagram` : recadre à la volée un visuel hors gabarit Instagram
 * (ratio hors [0.75 ; 1.91], ex. Reel 9:16 publié en image) — sinon la
 * publication échouait avec « Aspect ratio … outside Instagram's allowed range ».
 * Sans `fit`, ou si le ratio est déjà bon, l'original est servi (redirection
 * 302 s'il est hébergé ailleurs).
 *
 * Volontairement SANS authentification : la cible est un robot externe (le
 * réseau social) qui n'a aucune session. L'identifiant est un cuid non
 * devinable, et ces visuels sont de toute façon destinés à être publiés.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fitParam = new URL(req.url).searchParams.get('fit');
  const fit = isFitPreset(fitParam) ? fitParam : null;

  const asset = await db.mediaAsset.findUnique({
    where: { id },
    select: { url: true, mimeType: true },
  });
  if (!asset?.url) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const isRemote = /^https?:\/\//i.test(asset.url);
  // Déjà hébergé ailleurs et pas de recadrage demandé → on renvoie vers la source.
  if (isRemote && !fit) {
    return NextResponse.redirect(asset.url, 302);
  }

  let bytes: Buffer;
  let contentType: string;
  if (isRemote) {
    const res = await fetch(asset.url);
    if (!res.ok) return NextResponse.json({ error: 'UPSTREAM_UNAVAILABLE' }, { status: 502 });
    bytes = Buffer.from(await res.arrayBuffer());
    contentType = res.headers.get('content-type') ?? asset.mimeType ?? 'image/png';
  } else {
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(asset.url);
    if (!match) {
      return NextResponse.json({ error: 'UNSUPPORTED_MEDIA' }, { status: 415 });
    }
    contentType = match[1] || asset.mimeType || 'image/png';
    bytes = Buffer.from(match[2], 'base64');
  }

  if (fit && contentType.startsWith('image/')) {
    try {
      const fitted = await fitImage(bytes, fit);
      if (fitted) {
        bytes = fitted.bytes;
        contentType = fitted.contentType;
      } else if (isRemote) {
        // Ratio déjà conforme : inutile de re-servir l'octet, la source suffit.
        return NextResponse.redirect(asset.url, 302);
      }
    } catch {
      // Recadrage impossible (format exotique) : on sert l'original — le réseau
      // tranchera, mais on n'a rien cassé.
    }
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      // Le contenu d'un média est immuable : cache long, y compris côté CDN.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
