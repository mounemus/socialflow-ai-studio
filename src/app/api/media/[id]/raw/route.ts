import { isFitPreset } from '@/lib/media-fit';
import { serveMedia, toResponse } from '@/lib/media-serve';

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
 * Options (query, compat) : `?fit=instagram` recadre hors gabarit ; `?jpeg=1`
 * force le JPEG. Pour Instagram, préférer l'URL avec extension
 * /api/media/[id]/raw/instagram.jpg (voir raw/[name]).
 *
 * Volontairement SANS authentification : la cible est un robot externe (le
 * réseau social) qui n'a aucune session. L'identifiant est un cuid non
 * devinable, et ces visuels sont de toute façon destinés à être publiés.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const fitParam = sp.get('fit');
  return toResponse(
    await serveMedia(id, {
      fit: isFitPreset(fitParam) ? fitParam : null,
      forceJpeg: sp.get('jpeg') === '1',
    }),
  );
}
