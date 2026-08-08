import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { ComposerClient } from './ComposerClient';

export const dynamic = 'force-dynamic';

/**
 * Composeur d'une publication manuelle — parcours court et linéaire
 * (cible → texte → visuel → aperçu), tout sur UNE seule publication.
 * L'atelier complet `/studio` reste disponible pour les cas avancés
 * (carrousels, vidéo, Canva, variantes A/B).
 */
export default async function NewPostPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const [brands, activeBrandId] = await Promise.all([
    db.brand.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, name: true, profile: { select: { primaryColor: true } } },
      orderBy: { name: 'asc' },
    }),
    getActiveBrandId(membership.organizationId),
  ]);

  return <ComposerClient brands={brands} defaultBrandId={activeBrandId} />;
}
