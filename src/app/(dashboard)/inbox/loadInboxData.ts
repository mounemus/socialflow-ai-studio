import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getActiveBrandId } from '@/lib/tenant';
import { normalizeInteraction } from '@/lib/inbox-normalize';
import type { Interaction, TeamMemberLite } from './InboxClient';

/**
 * Hydratation serveur de la boîte de réception — extraite de la page /inbox
 * pour être partagée avec /conversations (Refonte Phase C).
 *
 * Requête le vrai modèle `SocialInteraction`, scopée sur la marque active
 * (les interactions sans marque restent visibles), normalisée via
 * normalizeInteraction — même shape que le poller client.
 */
export async function loadInboxData(orgId: string): Promise<{
  initialInteractions: Interaction[];
  teamMembers: TeamMemberLite[];
}> {
  let initialInteractions: Interaction[] = [];
  try {
    const activeBrandId = await getActiveBrandId(orgId);
    const rows = await db.socialInteraction.findMany({
      where: {
        organizationId: orgId,
        ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: 50,
      include: {
        brand: { select: { id: true, name: true } },
        post: { select: { id: true, title: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
    initialInteractions = rows.map(normalizeInteraction);
  } catch (err) {
    logger.error('loadInboxData: socialInteraction.findMany failed', {
      orgId,
      err: (err as Error).message,
    });
    initialInteractions = [];
  }

  const teamRows = await db.teamMember.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const teamMembers: TeamMemberLite[] = teamRows.map((t) => ({
    id: t.id,
    userId: t.userId,
    name: t.user?.name ?? t.user?.email ?? 'Membre',
    email: t.user?.email ?? null,
  }));

  return { initialInteractions, teamMembers };
}
