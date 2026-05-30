import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Workflow } from 'lucide-react';
import { resolvePipelineContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import { PipelineRunner } from './PipelineRunner';

export const dynamic = 'force-dynamic';

/**
 * Brand onboarding pipeline viewer.
 *
 * Server component: resolves the pipeline run through the tenant helper
 * (org membership / super-admin), hydrates the related brand + strategy +
 * items, and passes a normalized snapshot to the client runner.
 *
 * The client component owns:
 *   - polling /api/pipelines/[id] every 3s while non-terminal
 *   - rendering the state machine as a vertical stepper
 *   - per-step approval / regenerate / reject actions
 *   - per-strategy-item approve / reject / regenerate
 *   - live activity log
 */
export default async function PipelineRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let ctx: Awaited<ReturnType<typeof resolvePipelineContext>>;
  try {
    ctx = await resolvePipelineContext(id);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'UnauthorizedError') redirect('/login');
    if (name === 'ForbiddenError' || name === 'NotFoundError') notFound();
    throw err;
  }

  const { pipeline, organizationId } = ctx;

  // Hydrate optional relations in parallel.
  const [brand, strategy, startedBy, approvedProfileBy, approvedStrategyBy] = await Promise.all([
    pipeline.brandId
      ? db.brand.findUnique({
          where: { id: pipeline.brandId },
          include: { profile: true },
        })
      : Promise.resolve(null),
    pipeline.strategyId
      ? db.marketingStrategy.findUnique({
          where: { id: pipeline.strategyId },
          include: { items: { orderBy: { order: 'asc' } } },
        })
      : Promise.resolve(null),
    db.user.findUnique({
      where: { id: pipeline.startedById },
      select: { id: true, name: true, email: true },
    }),
    pipeline.approvedProfileById
      ? db.user.findUnique({
          where: { id: pipeline.approvedProfileById },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
    pipeline.approvedStrategyById
      ? db.user.findUnique({
          where: { id: pipeline.approvedStrategyById },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
  ]);

  // Compose the initial view passed to the client.
  const initial = {
    id: pipeline.id,
    organizationId,
    status: pipeline.status,
    step: pipeline.step,
    horizon: pipeline.horizon,
    language: pipeline.language,
    seed: (pipeline.seed ?? {}) as Record<string, unknown>,
    fieldStates: (pipeline.fieldStates ?? {}) as Record<string, unknown>,
    itemStates: (pipeline.itemStates ?? {}) as Record<string, unknown>,
    executionLog: Array.isArray(pipeline.executionLog) ? pipeline.executionLog : [],
    trace: Array.isArray(pipeline.trace) ? pipeline.trace : [],
    adminNotes: pipeline.adminNotes ?? null,
    approvedProfileAt: pipeline.approvedProfileAt?.toISOString() ?? null,
    approvedStrategyAt: pipeline.approvedStrategyAt?.toISOString() ?? null,
    completedAt: pipeline.completedAt?.toISOString() ?? null,
    failureReason: pipeline.failureReason ?? null,
    createdAt: pipeline.createdAt.toISOString(),
    updatedAt: pipeline.updatedAt.toISOString(),
    startedBy: startedBy
      ? { id: startedBy.id, name: startedBy.name, email: startedBy.email }
      : null,
    approvedProfileBy: approvedProfileBy
      ? { id: approvedProfileBy.id, name: approvedProfileBy.name, email: approvedProfileBy.email }
      : null,
    approvedStrategyBy: approvedStrategyBy
      ? { id: approvedStrategyBy.id, name: approvedStrategyBy.name, email: approvedStrategyBy.email }
      : null,
    brand: brand
      ? {
          id: brand.id,
          name: brand.name,
          industry: brand.industry,
          hasProfile: !!brand.profile,
        }
      : null,
    strategy: strategy
      ? {
          id: strategy.id,
          title: strategy.title,
          status: strategy.status,
          horizon: strategy.horizon,
          items: strategy.items.map((i) => ({
            id: i.id,
            order: i.order,
            kind: i.kind,
            status: i.status,
            title: i.title,
            description: i.description,
            platform: i.platform,
            format: i.format,
            suggestedDate: i.suggestedDate?.toISOString() ?? null,
            hashtags: i.hashtags,
            cta: i.cta,
            postId: i.postId,
            campaignId: i.campaignId,
          })),
        }
      : null,
    viewer: {
      userId: ctx.userId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      canApprove:
        ctx.isSuperAdmin || ctx.role === 'OWNER' || ctx.role === 'ADMIN' || ctx.role === 'SUPER_ADMIN',
    },
  };

  const seedName =
    typeof initial.seed?.name === 'string' ? (initial.seed.name as string) : undefined;
  const headerName = brand?.name ?? seedName ?? 'Pipeline d\'onboarding';

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={brand ? `/brands/${brand.id}` : '/brands'}
          className="text-xs text-slate-500 hover:underline"
        >
          <ArrowLeft className="h-3 w-3 inline" /> {brand ? `Marque ${brand.name}` : 'Marques'}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Workflow className="h-6 w-6 text-violet-600" />
          Pipeline — {headerName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Onboarding piloté par l&apos;agent IA : création marque, enrichissement profil, génération de
          stratégie, validation puis exécution. Les gates admin attendent ton approbation.
        </p>
      </div>

      <PipelineRunner initial={initial} />
    </div>
  );
}
