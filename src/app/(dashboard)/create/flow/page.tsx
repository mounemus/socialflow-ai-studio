import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { FlowCanvas } from './FlowCanvas';

export const dynamic = 'force-dynamic';

/**
 * Éditeur nodal (étape 1) — un graphe exécutable Brief → Texte → Visuel →
 * Publication. Alternative au parcours linéaire du composeur, pensée pour être
 * rejouée : le graphe s'enregistre et se relance sur un autre sujet.
 */
export default async function FlowPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const [brands, activeBrandId] = await Promise.all([
    db.brand.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getActiveBrandId(membership.organizationId),
  ]);

  return <FlowCanvas brands={brands} defaultBrandId={activeBrandId} />;
}
