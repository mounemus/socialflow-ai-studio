import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
 * Volontairement SANS authentification : la cible est un robot externe (le
 * réseau social) qui n'a aucune session. L'identifiant est un cuid non
 * devinable, et ces visuels sont de toute façon destinés à être publiés.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = await db.mediaAsset.findUnique({
    where: { id },
    select: { url: true, mimeType: true },
  });
  if (!asset?.url) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Déjà hébergé ailleurs → on renvoie simplement vers la source.
  if (/^https?:\/\//i.test(asset.url)) {
    return NextResponse.redirect(asset.url, 302);
  }

  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(asset.url);
  if (!match) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA' }, { status: 415 });
  }
  const contentType = match[1] || asset.mimeType || 'image/png';
  const bytes = Buffer.from(match[2], 'base64');

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
