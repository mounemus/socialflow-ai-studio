import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { CalendarClient } from './CalendarClient';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const [brands, socialAccounts, activeBrandId] = await Promise.all([
    db.brand.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.socialAccount.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, platform: true, handle: true, brandId: true },
      orderBy: { createdAt: 'asc' },
    }),
    getActiveBrandId(membership.organizationId),
  ]);

  // ?brand= : arrivée contextualisée (fin de pipeline → « Redirection vers le
  // calendrier ») — ce paramètre était envoyé par PipelineRunner puis JETÉ,
  // l'utilisateur atterrissait sur un calendrier non filtré.
  const sp = (await searchParams) ?? {};
  const brandParam = typeof sp.brand === 'string' ? sp.brand : undefined;
  const requestedBrand =
    brandParam && brands.some((b) => b.id === brandParam) ? brandParam : null;

  return (
    <CalendarClient
      brands={brands}
      socialAccounts={socialAccounts}
      initialBrandId={requestedBrand ?? activeBrandId}
    />
  );
}
