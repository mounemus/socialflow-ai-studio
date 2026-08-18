import { serveMedia, toResponse } from '@/lib/media-serve';

export const dynamic = 'force-dynamic';

/**
 * GET /api/media/[id]/raw/[name] — même média que /raw, mais avec une URL qui
 * porte une EXTENSION et un préréglage dans son nom :
 *   - `instagram.jpg` → recadré au gabarit Instagram + JPEG forcé
 *   - `image.jpg`     → JPEG forcé (transparence aplatie)
 *   - `image.png`     → original
 * Zernio/Instagram valident le format à partir de l'URL et refusaient
 * `raw?fit=instagram` (« unrecognized file format »).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const lower = name.toLowerCase();
  return toResponse(
    await serveMedia(id, {
      fit: lower.startsWith('instagram') ? 'instagram' : null,
      forceJpeg: /\.jpe?g$/.test(lower),
    }),
  );
}
