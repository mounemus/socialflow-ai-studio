import { Suspense } from 'react';
import { StudioShell } from './StudioShell';

export const dynamic = 'force-dynamic';

/**
 * Atelier créatif unifié — fusion fonctionnelle de Studio IA (texte),
 * Design Studio (visuel), Canva Studio et diffusion, en un seul parcours à
 * onglets : Brief → Texte → Visuel → Canva → Aperçu → Validation → Diffusion.
 *
 * Contexte injecté par query string : ?brandId=&postId=&platform=&format=
 * (utilisé par le Centre de travail et les pipelines pour ouvrir l'atelier
 * déjà contextualisé).
 */
export default function StudioPage() {
  return (
    <Suspense>
      <StudioShell />
    </Suspense>
  );
}
