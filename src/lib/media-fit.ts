/**
 * Gabarits d'image acceptés par les réseaux — et recadrage automatique.
 *
 * Instagram (feed) refuse toute image dont le ratio sort de [0.75 ; 1.91]
 * (« Aspect ratio 0.56:1 is outside Instagram's allowed range » constaté en
 * prod sur un visuel de Reel 9:16 publié en image). Plutôt que d'échouer à la
 * publication, on recadre au centre vers le gabarit le plus proche : 4:5 pour
 * un portrait trop haut, 1.91:1 pour un paysage trop large.
 */
import sharp from 'sharp';

export type FitPreset = 'instagram';

const PRESETS: Record<FitPreset, { min: number; max: number; portrait: number; landscape: number }> = {
  // ratio = largeur / hauteur
  instagram: { min: 0.75, max: 1.91, portrait: 0.8, landscape: 1.91 },
};

export function isFitPreset(v: string | null | undefined): v is FitPreset {
  return v === 'instagram';
}

/**
 * Renvoie l'image recadrée si son ratio sort du gabarit, sinon `null`
 * (= servir l'original tel quel). Sortie JPEG q90.
 */
export async function fitImage(bytes: Buffer, preset: FitPreset): Promise<{ bytes: Buffer; contentType: string } | null> {
  const p = PRESETS[preset];
  const img = sharp(bytes, { failOn: 'none' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) return null;
  const ratio = meta.width / meta.height;
  if (ratio >= p.min && ratio <= p.max) return null;
  const target = ratio < p.min ? p.portrait : p.landscape;
  // Recadrage centré (jamais de bandes) : on garde toute la largeur d'un
  // portrait trop haut, toute la hauteur d'un paysage trop large.
  const width = ratio < p.min ? meta.width : Math.round(meta.height * target);
  const height = ratio < p.min ? Math.round(meta.width / target) : meta.height;
  const out = await img
    .resize({ width, height, fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { bytes: out, contentType: 'image/jpeg' };
}
