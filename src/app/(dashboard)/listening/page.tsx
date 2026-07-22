import { auth } from '@/lib/auth';
import { getActiveMembership } from '@/lib/tenant';
import { ListeningClient } from './ListeningClient';
import { loadListeningData } from './loadListeningData';

export const dynamic = 'force-dynamic';

/**
 * Social Listening seul. Depuis la Phase C, /conversations regroupe cette
 * vue et la Boîte de réception en une seule destination — cette URL reste
 * servie pour les liens existants. L'hydratation vit dans loadListeningData
 * (partagée avec /conversations).
 */
export default async function ListeningPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const { initialMentions, alerts, watches } = await loadListeningData(membership.organizationId);
  return (
    <ListeningClient initialMentions={initialMentions} initialAlerts={alerts} watches={watches} />
  );
}
