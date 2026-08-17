import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { PerfRecoWidget } from '@/components/dashboard/PerfRecoWidget';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';
import { GeminiService } from '@/services/ai/GeminiService';
import { DashboardClient } from './DashboardClient';

export const dynamic = 'force-dynamic';

function firstNameFrom(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim().length > 0) {
    const first = name.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email) {
    const prefix = email.split('@')[0] ?? email;
    // Capitalize first letter for nicer greeting.
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }
  return 'utilisateur';
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId, {
    include: { organization: { include: { subscription: true } } },
  });
  if (!membership) return null;
  const orgId = membership.organizationId;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // La marque active est LE contexte : pipelines et programmations du cockpit
  // suivent le même périmètre que /pipelines et /calendar (avant : le cockpit
  // comptait « 4 pipelines actifs » toutes marques, /pipelines n'en montrait 1).
  const activeBrandId = await getActiveBrandId(orgId);
  const brandScope = activeBrandId ? { brandId: activeBrandId } : {};

  const [
    brandsCount,
    accountsCount,
    publishedPostsCount,
    timeseries,
    activePipelines,
    upcomingSchedules,
    topTrends,
  ] = await Promise.all([
    db.brand.count({ where: { organizationId: orgId } }),
    db.socialAccount.count({ where: { organizationId: orgId } }),
    db.post.count({
      where: {
        organizationId: orgId,
        status: 'PUBLISHED',
        updatedAt: { gte: thirtyDaysAgo },
      },
    }),
    AnalyticsService.timeseries(orgId, 14),
    db.brandPipelineRun.findMany({
      where: {
        organizationId: orgId,
        ...brandScope,
        status: { in: ['RUNNING', 'AWAITING_ADMIN'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      // Pas de colonnes JSON : le dashboard n'affiche qu'un résumé.
      select: {
        id: true,
        status: true,
        step: true,
        horizon: true,
        updatedAt: true,
        seed: true,
        brand: { select: { id: true, name: true } },
      },
    }),
    db.postSchedule.findMany({
      where: {
        post: { organizationId: orgId, ...brandScope },
        scheduledFor: { gte: now, lte: sevenDaysFromNow },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 8,
      include: { post: { include: { brand: true } }, socialAccount: true },
    }),
    db.trendItem.findMany({
      where: { trendWatch: { organizationId: orgId } },
      orderBy: { contentOpportunityScore: 'desc' },
      take: 5,
    }),
  ]);

  // Production-in-progress: posts not yet ready, that have at least one schedule (any manual/auto).
  const scheduledPostIds = Array.from(new Set(upcomingSchedules.map((s) => s.postId)));
  const productionPosts = scheduledPostIds.length
    ? await db.post.findMany({
        where: {
          organizationId: orgId,
          id: { in: scheduledPostIds },
          status: { in: ['DRAFT', 'AI_GENERATED', 'PENDING_APPROVAL'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: {
          brand: true,
          _count: { select: { media: true } },
        },
      })
    : [];

  const firstName = firstNameFrom(session?.user?.name, session?.user?.email);

  return (
    <div className="space-y-6">
    <DashboardClient
      orgName={membership.organization.name}
      firstName={firstName}
      planLabel={membership.organization.plan}
      miniStats={{
        brands: brandsCount,
        accounts: accountsCount,
        published30d: publishedPostsCount,
      }}
      engagementSparkline={timeseries.map((t) => ({
        date: t.date,
        value: t.engagement,
      }))}
      activePipelines={activePipelines.map((p) => ({
        id: p.id,
        title: p.brand?.name
          ? `Pipeline ${p.brand.name}`
          : `Pipeline ${p.id.slice(0, 8)}`,
        status: p.status,
        step: p.step,
        brandName: p.brand?.name ?? null,
        horizon: p.horizon,
        updatedAt: p.updatedAt.toISOString(),
      }))}
      upcomingSchedules={upcomingSchedules.map((s) => ({
        id: s.id,
        postId: s.postId,
        scheduledFor: s.scheduledFor.toISOString(),
        platform: s.socialAccount?.platform ?? 'MANUAL',
        brandName: s.post.brand?.name ?? null,
        postTitle: s.post.title ?? (s.post.body ?? '').slice(0, 60),
        shareMode: s.shareMode ?? 'AUTO',
        isManual: (s.shareMode ?? 'AUTO') === 'MANUAL' || !s.socialAccountId,
      }))}
      productionPosts={productionPosts.map((p) => ({
        id: p.id,
        title: p.title ?? (p.body ?? '').slice(0, 60) ?? 'Sans titre',
        brandName: p.brand?.name ?? null,
        format: p.format,
        status: p.status,
        hasMedia: p._count.media > 0,
        scoreOverall: null,
        updatedAt: p.updatedAt.toISOString(),
      }))}
      topTrends={topTrends.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url ?? null,
        score: t.contentOpportunityScore ?? 0,
      }))}
      geminiAvailable={GeminiService.isConfigured()}
      kpis={{
        impressions: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        engagementRate: 0,
      }}
      activeBrandId={activeBrandId}
    />
    <PerfRecoWidget brandId={activeBrandId} />
    </div>
  );
}
