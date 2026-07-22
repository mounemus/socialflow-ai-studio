import { auth } from '@/lib/auth';
import { getActiveMembership } from '@/lib/tenant';
import { loadInboxData } from '../inbox/loadInboxData';
import { loadListeningData } from '../listening/loadListeningData';
import { ConversationsClient } from './ConversationsClient';

export const dynamic = 'force-dynamic';

/**
 * Conversations (Refonte Phase C) — fusion navigationnelle de la Boîte de
 * réception et du Social Listening. Les hydratations serveur sont partagées
 * avec les pages historiques /inbox et /listening (toujours servies).
 */
export default async function ConversationsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;
  const orgId = membership.organizationId;

  const [inbox, listening] = await Promise.all([loadInboxData(orgId), loadListeningData(orgId)]);

  return (
    <ConversationsClient
      inbox={inbox}
      listening={{
        initialMentions: listening.initialMentions,
        alerts: listening.alerts,
        watches: listening.watches,
      }}
    />
  );
}
