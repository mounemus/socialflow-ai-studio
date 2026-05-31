/**
 * Smoke tests for ReportingService.
 *
 * Mocks:
 *   - @/lib/db                 : in-memory Prisma stand-in (pattern from
 *                                brand-pipeline-service.test.ts). Only the tables
 *                                ReportingService touches are implemented.
 *   - @/services/ai/AIRouterService : predictable, deterministic AI summary so
 *                                generateReport() is reproducible offline.
 *
 * Covers:
 *   1. resolvePeriod('LAST_30_DAYS') → ~30-day window with correct label.
 *   2. computeNextRun('WEEKLY'|'MONTHLY'|'ONCE', date) → +7d / +1month / null.
 *   3. generateReport() → status READY, persists aiSummary + data (gatherData mocked).
 *   4. gatherData() → zeroed overview when no posts exist (defensive).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org_1';

interface ReportRecord {
  id: string;
  organizationId: string;
  brandId: string | null;
  title: string;
  status: string;
  period: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  sections: string[];
  whiteLabel: unknown;
  data: unknown;
  aiSummary: string | null;
  pdfUrl: string | null;
  generatedAt: Date | null;
  errorMessage: string | null;
  createdById: string | null;
  scheduleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const store: {
  reports: ReportRecord[];
  seq: number;
} = { reports: [], seq: 0 };

function nextId(prefix: string): string {
  store.seq += 1;
  return `${prefix}_${store.seq}`;
}

vi.mock('@/lib/db', () => {
  const report = {
    create: vi.fn(async (args: { data: Partial<ReportRecord> }) => {
      const now = new Date();
      const rec: ReportRecord = {
        id: nextId('report'),
        organizationId: args.data.organizationId as string,
        brandId: (args.data.brandId as string | null) ?? null,
        title: (args.data.title as string) ?? 'Rapport',
        status: (args.data.status as string) ?? 'DRAFT',
        period: (args.data.period as string) ?? 'LAST_30_DAYS',
        periodStart: (args.data.periodStart as Date | null) ?? null,
        periodEnd: (args.data.periodEnd as Date | null) ?? null,
        sections: (args.data.sections as string[]) ?? [],
        whiteLabel: args.data.whiteLabel ?? {},
        data: args.data.data ?? {},
        aiSummary: (args.data.aiSummary as string | null) ?? null,
        pdfUrl: null,
        generatedAt: null,
        errorMessage: null,
        createdById: (args.data.createdById as string | null) ?? null,
        scheduleId: (args.data.scheduleId as string | null) ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.reports.push(rec);
      return rec;
    }),
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return store.reports.find((r) => r.id === args.where.id) ?? null;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<ReportRecord> }) => {
      const idx = store.reports.findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw new Error(`report ${args.where.id} not found`);
      const merged = { ...store.reports[idx], ...args.data, updatedAt: new Date() } as ReportRecord;
      store.reports[idx] = merged;
      return merged;
    }),
  };

  // Empty tables → exercises the defensive "no posts" path of gatherData().
  const emptyAggregate = vi.fn(async () => ({
    _sum: { impressions: null, reach: null, likes: null, comments: null, shares: null },
  }));
  const emptyFindMany = vi.fn(async () => [] as unknown[]);
  const zeroCount = vi.fn(async () => 0);
  const findUniqueNull = vi.fn(async () => null);

  return {
    db: {
      report,
      post: { findMany: emptyFindMany, count: zeroCount },
      postAnalytics: { aggregate: emptyAggregate, findMany: emptyFindMany },
      organization: { findUnique: findUniqueNull },
      brand: { findUnique: findUniqueNull },
      competitor: { findMany: emptyFindMany },
    },
  };
});

vi.mock('@/services/ai/AIRouterService', () => ({
  AIRouterService: {
    generateTextForTask: vi.fn(async () => ({
      text: '[MOCK SUMMARY] Performances stables sur la période.',
      provider: 'mock',
      durationMs: 1,
      mocked: true,
    })),
  },
}));

// Import AFTER the mocks so the SUT picks up the in-memory db + mocked router.
const { ReportingService } = await import('@/services/reporting/ReportingService');

describe('ReportingService (smoke)', () => {
  beforeEach(() => {
    store.reports = [];
    store.seq = 0;
  });

  it("resolvePeriod('LAST_30_DAYS') returns a ~30-day window with the right label", () => {
    const { start, end, label } = ReportingService.resolvePeriod('LAST_30_DAYS');
    expect(label).toBe('30 derniers jours');
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
    expect(Math.round(spanDays)).toBe(30);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("computeNextRun: WEEKLY=+7d, MONTHLY=+1month, ONCE=null", () => {
    const base = new Date('2026-01-15T08:00:00.000Z');

    const weekly = ReportingService.computeNextRun('WEEKLY', base);
    expect(weekly).not.toBeNull();
    expect(weekly!.getTime() - base.getTime()).toBe(7 * 86_400_000);

    const monthly = ReportingService.computeNextRun('MONTHLY', base);
    expect(monthly).not.toBeNull();
    const expectedMonthly = new Date(base);
    expectedMonthly.setMonth(expectedMonthly.getMonth() + 1);
    expect(monthly!.getTime()).toBe(expectedMonthly.getTime());
    // sanity: lands in February
    expect(monthly!.getUTCMonth()).toBe(1);

    const once = ReportingService.computeNextRun('ONCE', base);
    expect(once).toBeNull();
  });

  it('generateReport sets status READY and persists aiSummary + data (gatherData mocked)', async () => {
    const { db } = await import('@/lib/db');
    const row = await db.report.create({
      data: {
        organizationId: ORG_ID,
        brandId: null,
        title: 'Rapport mensuel',
        period: 'LAST_30_DAYS',
        sections: ['overview'],
        status: 'DRAFT',
      },
    });

    // Mock gatherData so the test is deterministic and independent of analytics.
    const fakeData = {
      meta: { generatedAt: new Date().toISOString(), periodLabel: '30 derniers jours', brandName: 'Acme', orgName: 'Org' },
      overview: {
        totalPosts: 3,
        totalImpressions: 1000,
        totalEngagement: 120,
        totalReach: 800,
        avgEngagementRate: 12,
        deltaVsPrevious: { impressions: 0, engagement: 0, reach: 0, posts: 0, engagementRatePct: 0 },
      },
      engagement: { timeseries: [], byType: { likes: 100, comments: 15, shares: 5 } },
      topPosts: [],
      platforms: [],
    };
    const gatherSpy = vi
      .spyOn(ReportingService, 'gatherData')
      .mockResolvedValue(fakeData as never);

    const result = await ReportingService.generateReport(row.id);

    expect(gatherSpy).toHaveBeenCalledOnce();
    expect(result.status).toBe('READY');
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.aiSummary).toBeTruthy();
    // persisted data round-trips the mocked gatherData output
    expect((result.data as typeof fakeData).overview.totalPosts).toBe(3);

    // and it was actually written to the store
    const persisted = store.reports.find((r) => r.id === row.id)!;
    expect(persisted.status).toBe('READY');
    expect(persisted.aiSummary).toBeTruthy();

    gatherSpy.mockRestore();
  });

  it('gatherData returns a zeroed overview when no posts exist (defensive)', async () => {
    const data = await ReportingService.gatherData({
      organizationId: ORG_ID,
      brandId: null,
      period: 'LAST_30_DAYS',
    });

    expect(data.overview.totalPosts).toBe(0);
    expect(data.overview.totalImpressions).toBe(0);
    expect(data.overview.totalEngagement).toBe(0);
    expect(data.overview.totalReach).toBe(0);
    expect(data.overview.avgEngagementRate).toBe(0);
    expect(data.topPosts).toEqual([]);
    expect(data.platforms).toEqual([]);
    expect(data.engagement.byType).toEqual({ likes: 0, comments: 0, shares: 0 });
  });
});
