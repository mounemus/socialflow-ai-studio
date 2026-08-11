import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { CampaignsClient } from './CampaignsClient';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  // Contexte de marque global : la liste ne mélange plus toutes les marques.
  const activeBrandId = await getActiveBrandId(membership.organizationId);
  const [items, brands] = await Promise.all([
    db.campaign.findMany({
      where: {
        organizationId: membership.organizationId,
        ...(activeBrandId ? { brandId: activeBrandId } : {}),
      },
      include: { brand: { select: { id: true, name: true } }, _count: { select: { posts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.brand.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return <CampaignsClient initialItems={items} brands={brands} activeBrandId={activeBrandId} />;
}
