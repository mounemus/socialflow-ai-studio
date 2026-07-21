import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const createSchema = z.object({
  brandSeed: z.object({
    name: z.string().min(1),
    industry: z.string().optional(),
    description: z.string().optional(),
    website: z.string().optional(),
    audienceHint: z.string().optional(),
  }),
  horizon: z.enum(['30d', '90d', '12mo']).default('90d'),
  language: z.string().default('fr'),
  autoMode: z.boolean().default(false),
});

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const brandId = url.searchParams.get('brandId') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;

  // Liste : jamais les colonnes JSON lourdes (`fieldStates`, `itemStates`,
  // `executionLog`, `trace`) — plusieurs Mo par run, sans `take` c'était un
  // OOM garanti dès qu'une organisation accumulait des pipelines.
  const runs = await db.brandPipelineRun.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(brandId ? { brandId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    select: {
      id: true,
      status: true,
      step: true,
      horizon: true,
      language: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      seed: true,
      brand: { select: { id: true, name: true } },
      strategy: { select: { id: true, title: true, status: true } },
      startedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return ok(runs);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'brand.manage');
  const body = createSchema.parse(await req.json());

  const { runId } = await BrandPipelineService.start({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    seed: body.brandSeed,
    horizon: body.horizon,
    language: body.language,
  });

  const run = await db.brandPipelineRun.findUnique({
    where: { id: runId },
    include: {
      brand: { select: { id: true, name: true } },
      startedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return created({ pipeline: run, autoMode: body.autoMode });
});
