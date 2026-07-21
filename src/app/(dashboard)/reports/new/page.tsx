import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { ReportWizardClient } from './ReportWizardClient';

export const dynamic = 'force-dynamic';

export default async function NewReportPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const brands = await db.brand.findMany({
    where: { organizationId: membership.organizationId },
    select: { id: true, name: true, logo: true },
    orderBy: { name: 'asc' },
  });

  return <ReportWizardClient brands={brands} />;
}
