import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { StudioShell } from './StudioShell';

export const dynamic = 'force-dynamic';

/**
 * Atelier créatif unifié — fusion fonctionnelle de Studio IA (texte),
 * Design Studio (visuel), Canva Studio et diffusion, en un seul parcours à
 * onglets : Brief → Texte → Visuel → Canva → Aperçu → Validation → Diffusion.
 *
 * Contexte injecté par query string : ?brandId=&postId=&platform=&format=
 * (utilisé par le Centre de travail et les pipelines pour ouvrir l'atelier
 * déjà contextualisé). Sans query string, la marque active du contexte
 * global (sélecteur de la Topbar) sert de défaut.
 */
export default async function StudioPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  const activeBrandId = membership
    ? await getActiveBrandId(membership.organizationId)
    : null;
  // `fallback` OBLIGATOIRE : StudioShell appelle `useSearchParams()`, ce qui
  // fait basculer cette frontière en rendu client. Sans fallback, la zone
  // restait vide et ne s'hydratait jamais — l'Atelier s'affichait entièrement
  // blanc (aucune erreur, aucun log : juste rien).
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
          Chargement de l’atelier…
        </div>
      }
    >
      <StudioShell defaultBrandId={activeBrandId} />
    </Suspense>
  );
}
