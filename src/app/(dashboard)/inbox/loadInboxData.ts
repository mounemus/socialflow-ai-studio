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
    const baseWhere = {
      organizationId: orgId,
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
    };
    const include = {
      brand: { select: { id: true, name: true } },
      post: { select: { id: true, title: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    };
    // Un seul `take` global peut être dominé par un scope (ex.: spam email
    // qui noie les interactions réseaux) — on interroge les deux scopes
    // (réseaux sociaux / emails) séparément pour garantir des données dans
    // les deux onglets du client (InboxClient scope=SOCIAL|EMAIL).
    const [socialRows, emailRows] = await Promise.all([
      db.socialInteraction.findMany({
        where: { ...baseWhere, NOT: { platform: 'EMAIL' } },
        orderBy: { receivedAt: 'desc' },
        take: 50,
        include,
      }),
      db.socialInteraction.findMany({
        where: { ...baseWhere, platform: 'EMAIL' },
        orderBy: { receivedAt: 'desc' },
        take: 50,
        include,
      }),
    ]);
    initialInteractions = [...socialRows, ...emailRows]
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .map(normalizeInteraction);
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
