import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

/**
 * GET /api/outreach/contacts?platform=INSTAGRAM — contacts joignables en
 * messagerie : personnes ayant déjà une conversation dans l'inbox (on ne peut
 * répondre qu'à une conversation existante — pas de DM à froid).
 * Un contact = dernier échange par (platform, fromHandle).
 */
export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform');
  const activeBrandId = await getActiveBrandId(ctx.organizationId);

  const rows = await db.socialInteraction.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(platform ? { platform: platform as never } : {}),
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
    },
    select: {
      id: true,
      platform: true,
      fromHandle: true,
      fromName: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: 'desc' },
    take: 500,
  });

  // Dernière interaction par contact (les lignes arrivent triées desc).
  const seen = new Set<string>();
  const contacts: { handle: string; name: string | null; platform: string; interactionId: string }[] = [];
  for (const r of rows) {
    const key = `${r.platform}:${r.fromHandle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      handle: r.fromHandle,
      name: r.fromName,
      platform: r.platform,
      interactionId: r.id,
    });
  }
  return ok({ contacts: contacts.slice(0, 200) });
});
