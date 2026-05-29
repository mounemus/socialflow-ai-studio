import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';
import { GeminiService } from '@/services/ai/GeminiService';
import { DashboardClient } from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId, {
    include: { organization: { include: { subscription: true } } },
  });
  if (!membership) return null;
  const orgId = membership.organizationId;

  const [
    overview,
    recentPosts,
    brands,
    accountsCount,
    timeseries,
    byPlatform,
    recentAgentRuns,
    upcomingSchedules,
    topTrends,
  ] = await Promise.all([
    AnalyticsService.overview(orgId),
    db.post.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { brand: true },
    }),
    db.brand.findMany({ where: { organizationId: orgId } }),
    db.socialAccount.count({ where: { organizationId: orgId } }),
    AnalyticsService.timeseries(orgId, 14),
    AnalyticsService.byPlatform(orgId),
    db.agentRun.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    db.postSchedule.findMany({
      where: { post: { organizationId: orgId }, scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: 5,
      include: { post: { include: { brand: true } }, socialAccount: true },
    }),
    db.trendItem.findMany({
      where: { trendWatch: { organizationId: orgId } },
      orderBy: { contentOpportunityScore: 'desc' },
      take: 3,
    }),
  ]);

  return (
    <DashboardClient
      orgName={membership.organization.name}
      userName={session?.user?.name ?? session?.user?.email ?? 'utilisateur'}
      stats={{
        posts: overview.counts.posts,
        scheduled: overview.counts.scheduled,
        published: overview.counts.published,
        failed: overview.counts.failed,
        impressions: overview.totals.impressions,
        likes: overview.totals.likes,
        comments: overview.totals.comments,
        shares: overview.totals.shares,
        clicks: overview.totals.clicks,
        engagementRate: overview.engagementRate ?? 0,
        brands: brands.length,
        accounts: accountsCount,
      }}
      timeseries={timeseries}
      byPlatform={byPlatform}
      recentPosts={recentPosts.map((p) => ({
        id: p.id,
        title: p.title ?? (p.body ?? '').slice(0, 60),
        brandName: p.brand?.name ?? null,
        format: p.format,
        status: p.status,
        updatedAt: p.updatedAt.toISOString(),
      }))}
      upcomingSchedules={upcomingSchedules.map((s) => ({
        id: s.id,
        scheduledFor: s.scheduledFor.toISOString(),
        platform: s.socialAccount.platform,
        brandName: s.post.brand?.name ?? null,
        postTitle: s.post.title ?? (s.post.body ?? '').slice(0, 60),
      }))}
      recentAgentRuns={recentAgentRuns.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        title: r.title ?? r.kind,
        createdAt: r.createdAt.toISOString(),
      }))}
      topTrends={topTrends.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url ?? null,
        score: t.contentOpportunityScore ?? 0,
      }))}
      brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      planLabel={membership.organization.plan}
      geminiAvailable={GeminiService.isConfigured()}
    />
  );
}
