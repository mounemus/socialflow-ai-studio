'use client';

import {
  HeroBar,
  BrandJourney,
  NextActionCard,
  ActivePipelinesPanel,
  UpcomingWeekPanel,
  ProductionInProgressPanel,
  IntelligenceAccordion,
} from '@/components/dashboard';

export type MiniStats = {
  brands: number;
  accounts: number;
  published30d: number;
};

export type SparkPoint = { date: string; value: number };

export type ActivePipeline = {
  id: string;
  title: string;
  status: string;
  step: string;
  brandName: string | null;
  horizon?: string;
  updatedAt: string;
};

export type UpcomingScheduleItem = {
  id: string;
  postId?: string;
  scheduledFor: string;
  platform: string;
  brandName: string | null;
  postTitle: string;
  shareMode: 'AUTO' | 'MANUAL' | string;
  isManual?: boolean;
};

export type ProductionPost = {
  id: string;
  title: string;
  brandName: string | null;
  format: string;
  status?: string;
  hasMedia: boolean;
  scoreOverall: number | null;
  updatedAt?: string;
};

export type TopTrend = {
  id: string;
  title: string;
  url: string | null;
  score: number;
};

export type DashboardKpis = {
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  engagementRate: number;
};

export interface DashboardClientProps {
  orgName: string;
  firstName: string;
  planLabel: string;
  miniStats: MiniStats;
  engagementSparkline: SparkPoint[];
  activePipelines: ActivePipeline[];
  upcomingSchedules: UpcomingScheduleItem[];
  productionPosts: ProductionPost[];
  topTrends?: TopTrend[];
  geminiAvailable?: boolean;
  kpis: DashboardKpis;
  activeBrandId?: string | null;
}

export function DashboardClient({
  orgName,
  firstName,
  planLabel,
  miniStats,
  engagementSparkline,
  activePipelines,
  upcomingSchedules,
  productionPosts,
  kpis,
  activeBrandId,
}: DashboardClientProps) {
  return (
    <div className="space-y-6">
      {/* Zone 1 — HeroBar */}
      <HeroBar
        userFirstName={firstName}
        orgName={orgName}
        planLabel={planLabel}
        brandCount={miniStats.brands}
        socialAccountCount={miniStats.accounts}
        post30dCount={miniStats.published30d}
        sparkline14d={engagementSparkline}
      />

      {/* Zone 2 — le fil conducteur « Orbit » : où j'en suis, quelle est la
          prochaine action utile. Puis l'opportunité du jour détectée par l'IA. */}
      <BrandJourney />
      <NextActionCard />

      {/* Zone 3 — Pipelines (left) + Upcoming week (right) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ActivePipelinesPanel pipelines={activePipelines} />
        </div>
        <div className="lg:col-span-2">
          <UpcomingWeekPanel schedules={upcomingSchedules} />
        </div>
      </div>

      {/* Zone 4 — Production in progress */}
      <ProductionInProgressPanel posts={productionPosts} />

      {/* Zone 5 — Intelligence (collapsed, lazy brief on expand) */}
      <IntelligenceAccordion kpis={kpis} brandId={activeBrandId ?? null} />
    </div>
  );
}
