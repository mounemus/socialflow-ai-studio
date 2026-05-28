import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { CalendarClient } from './CalendarClient';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const [brands, socialAccounts] = await Promise.all([
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
  ]);

  return (
    <CalendarClient
      brands={brands}
      socialAccounts={socialAccounts}
    />
  );
}
