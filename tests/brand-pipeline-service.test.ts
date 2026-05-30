/**
 * Smoke test for BrandPipelineService.
 *
 * Mocks @/lib/db (Prisma client) with an in-memory store so the state machine
 * can be exercised end-to-end without a real database. Verifies:
 *   1. createPipeline (start) returns a run in initial state RUNNING / CREATE_BRAND
 *   2. approveStep on a non-existent pipeline throws
 *   3. rejectStep persists the feedback (adminNotes + trace) on the pipeline
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org_1';
const USER_ID = 'user_1';

interface PipelineRecord {
  id: string;
  organizationId: string;
  brandId: string | null;
  startedById: string;
  horizon: string;
  language: string;
  status: string;
  step: string;
  seed: unknown;
  trace: unknown[];
  adminNotes: string | null;
  approvedProfileAt: Date | null;
  approvedProfileById: string | null;
  approvedStrategyAt: Date | null;
  approvedStrategyById: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface BrandRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  industry: string | null;
  description: string | null;
}

const store: {
  pipelines: PipelineRecord[];
  brands: BrandRecord[];
  seq: number;
} = { pipelines: [], brands: [], seq: 0 };

function nextId(prefix: string): string {
  store.seq += 1;
  return `${prefix}_${store.seq}`;
}

vi.mock('@/lib/db', () => {
  const brandPipelineRun = {
    create: vi.fn(async (args: { data: Partial<PipelineRecord> }) => {
      const now = new Date();
      const rec: PipelineRecord = {
        id: nextId('run'),
        organizationId: args.data.organizationId as string,
        brandId: (args.data.brandId as string | null) ?? null,
        startedById: args.data.startedById as string,
        horizon: (args.data.horizon as string) ?? '90d',
        language: (args.data.language as string) ?? 'fr',
        status: (args.data.status as string) ?? 'RUNNING',
        step: (args.data.step as string) ?? 'CREATE_BRAND',
        seed: args.data.seed ?? {},
        trace: (args.data.trace as unknown[]) ?? [],
        adminNotes: (args.data.adminNotes as string | null) ?? null,
        approvedProfileAt: null,
        approvedProfileById: null,
        approvedStrategyAt: null,
        approvedStrategyById: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.pipelines.push(rec);
      return rec;
    }),
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return store.pipelines.find((p) => p.id === args.where.id) ?? null;
    }),
    findFirst: vi.fn(async (args: { where: { id: string; organizationId?: string } }) => {
      return (
        store.pipelines.find(
          (p) =>
            p.id === args.where.id &&
            (args.where.organizationId === undefined || p.organizationId === args.where.organizationId),
        ) ?? null
      );
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<PipelineRecord> }) => {
      const idx = store.pipelines.findIndex((p) => p.id === args.where.id);
      if (idx < 0) throw new Error(`pipeline ${args.where.id} not found`);
      const merged: PipelineRecord = { ...store.pipelines[idx], ...args.data, updatedAt: new Date() } as PipelineRecord;
      store.pipelines[idx] = merged;
      return merged;
    }),
  };

  const brand = {
    create: vi.fn(async (args: { data: Partial<BrandRecord> }) => {
      const rec: BrandRecord = {
        id: nextId('brand'),
        organizationId: args.data.organizationId as string,
        name: args.data.name as string,
        slug: args.data.slug as string,
        industry: (args.data.industry as string | null) ?? null,
        description: (args.data.description as string | null) ?? null,
      };
      store.brands.push(rec);
      return rec;
    }),
    // findFirst is used by uniqueBrandSlug() — return existing record or null
    findFirst: vi.fn(async (args: { where?: { organizationId?: string; slug?: string } }) => {
      const where = args.where ?? {};
      return store.brands.find((b) =>
        (where.organizationId === undefined || b.organizationId === where.organizationId) &&
        (where.slug === undefined || b.slug === where.slug)
      ) ?? null;
    }),
  };

  return { db: { brandPipelineRun, brand } };
});

// Import AFTER the mock so the SUT picks up the in-memory db.
const { BrandPipelineService } = await import('@/services/pipeline/BrandPipelineService');

describe('BrandPipelineService (smoke)', () => {
  beforeEach(() => {
    store.pipelines = [];
    store.brands = [];
    store.seq = 0;
  });

  it('start() creates a pipeline in initial state RUNNING / CREATE_BRAND', async () => {
    const { runId, brandId } = await BrandPipelineService.start({
      organizationId: ORG_ID,
      userId: USER_ID,
      seed: { name: 'Acme Coffee', industry: 'food', description: 'specialty coffee shop' },
      horizon: '90d',
      language: 'fr',
    });

    expect(runId).toBeTruthy();
    expect(brandId).toBeTruthy();

    const run = store.pipelines.find((p) => p.id === runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe('RUNNING');
    expect(run!.step).toBe('CREATE_BRAND');
    expect(run!.organizationId).toBe(ORG_ID);
    expect(run!.startedById).toBe(USER_ID);
    expect(run!.brandId).toBe(brandId);
    // initial trace entry should be present
    expect(Array.isArray(run!.trace)).toBe(true);
    expect((run!.trace as unknown[]).length).toBeGreaterThan(0);
  });

  it('approveProfile() on a non-existent pipeline throws', async () => {
    await expect(
      BrandPipelineService.approveProfile('does-not-exist', USER_ID),
    ).rejects.toThrow(/not found/i);
  });

  it('approveProfile() on a pipeline not in VALIDATE_PROFILE step throws', async () => {
    const { runId } = await BrandPipelineService.start({
      organizationId: ORG_ID,
      userId: USER_ID,
      seed: { name: 'Brand X' },
    });
    // freshly started run is at CREATE_BRAND, not VALIDATE_PROFILE
    await expect(BrandPipelineService.approveProfile(runId, USER_ID)).rejects.toThrow(/Cannot approve profile/);
  });

  it('rejectStep() stores feedback in adminNotes and trace history', async () => {
    const { runId } = await BrandPipelineService.start({
      organizationId: ORG_ID,
      userId: USER_ID,
      seed: { name: 'Brand Y' },
    });

    const feedback = 'Slogan trop générique, refais avec un angle premium';
    const result = await BrandPipelineService.rejectStep(runId, 'VALIDATE_PROFILE', feedback, USER_ID);

    expect(result.feedback).toBe(feedback);
    expect(result.status).toBe('AWAITING_ADMIN');

    const run = store.pipelines.find((p) => p.id === runId)!;
    expect(run.adminNotes).toContain(feedback);
    expect(run.adminNotes).toContain('VALIDATE_PROFILE');

    const traceArr = run.trace as Array<{ action: string; step: string; detail?: { feedback?: string } }>;
    const rejectEntry = traceArr.find((t) => t.action === 'reject');
    expect(rejectEntry).toBeDefined();
    expect(rejectEntry!.step).toBe('VALIDATE_PROFILE');
    expect(rejectEntry!.detail?.feedback).toBe(feedback);
  });

  it('rejectStep() on a non-existent pipeline throws', async () => {
    await expect(
      BrandPipelineService.rejectStep('nope', 'VALIDATE_PROFILE', 'bad', USER_ID),
    ).rejects.toThrow(/not found/i);
  });
});
