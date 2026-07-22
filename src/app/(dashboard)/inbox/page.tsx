import { auth } from '@/lib/auth';
import { getActiveMembership } from '@/lib/tenant';
import { InboxClient } from './InboxClient';
import { loadInboxData } from './loadInboxData';

export const dynamic = 'force-dynamic';

/**
 * Boîte de réception seule. Depuis la Phase C, /conversations regroupe
 * cette vue et le Social Listening en une seule destination — cette URL
 * reste servie pour les liens existants. L'hydratation vit dans
 * loadInboxData (partagée avec /conversations).
 */
export default async function InboxPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const { initialInteractions, teamMembers } = await loadInboxData(membership.organizationId);
  return <InboxClient initialInteractions={initialInteractions} teamMembers={teamMembers} />;
}
