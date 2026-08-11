import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { IntelligentWatchService, type WatchReportContent } from '@/services/watch/IntelligentWatchService';
import { CompetitorsClient, type SerializedCompetitor } from './CompetitorsClient';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const comps = await db.competitor.findMany({
    where: { organizationId: membership.organizationId },
    include: {
      watchReports: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <CompetitorsClient
      configured={IntelligentWatchService.isConfigured()}
      competitors={comps.map((c): SerializedCompetitor => ({
        id: c.id,
        name: c.name,
        website: c.website,
        industry: c.industry,
        country: c.country,
        report: c.watchReports[0]
          ? {
              title: c.watchReports[0].title,
              createdAt: c.watchReports[0].createdAt.toISOString(),
              content: c.watchReports[0].content as WatchReportContent,
              sources: (c.watchReports[0].sources as Array<{ uri?: string; title?: string }>) ?? [],
            }
          : null,
      }))}
    />
  );
}
