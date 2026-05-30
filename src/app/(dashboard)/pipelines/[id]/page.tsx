import { notFound, redirect } from 'next/navigation';
import { resolvePipelineContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import { PipelineRunner, type PipelineView } from './PipelineRunner';

export const dynamic = 'force-dynamic';

/**
 * Brand onboarding pipeline viewer — 5-Act narrative experience.
 *
 * Server component: resolves the pipeline run through the tenant helper
 * (org membership / super-admin), hydrates brand + brand.profile + strategy +
 * items + recent media, and passes a normalized snapshot to the client runner.
 *
 * The client component (PipelineRunner) owns the full 5-Act vertical scroll:
 *   Act1: Déclaration de marque
 *   Act2: Enrichissement IA
 *   Act3: Génération stratégie
 *   Act4: Concrétisation (preview + items)
 *   Act5: Action (calendrier + planification)
 *
 * Polling, auto-mode, smart-scroll, and the sticky mini-map all live in the
 * client component. This page only hydrates the initial snapshot.
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

  // Hydrate optional relations in parallel: brand + profile, strategy + items,
  // user attribution rows, plus the latest media generated for the brand
  // (used by Act4 to show actual visuals from the production pipeline).
  const [
    brand,
    strategy,
    startedBy,
    approvedProfileBy,
    approvedStrategyBy,
    recentMedia,
  ] = await Promise.all([
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
    pipeline.brandId
      ? db.mediaAsset
          .findMany({
            where: { brandId: pipeline.brandId },
            orderBy: { createdAt: 'desc' },
            take: 12,
            select: {
              id: true,
              url: true,
              kind: true,
              createdAt: true,
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const initial: PipelineView = {
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
          profile: brand.profile
            ? {
                slogan: brand.profile.slogan ?? null,
                mission: brand.profile.mission ?? null,
                audienceTarget: brand.profile.audienceTarget ?? null,
                toneOfVoice: brand.profile.toneOfVoice ?? null,
                wordsToUse: brand.profile.wordsToUse ?? [],
                wordsToAvoid: brand.profile.wordsToAvoid ?? [],
                officialHashtags: brand.profile.officialHashtags ?? [],
                primaryColor: brand.profile.primaryColor ?? null,
                secondaryColor: brand.profile.secondaryColor ?? null,
                accentColor: brand.profile.accentColor ?? null,
                visualStyle: brand.profile.visualStyle ?? null,
              }
            : null,
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
    recentMedia: (recentMedia ?? []).map((m) => ({
      id: m.id,
      url: m.url,
      type: String(m.kind),
      createdAt: m.createdAt.toISOString(),
    })),
    viewer: {
      userId: ctx.userId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      canApprove:
        ctx.isSuperAdmin || ctx.role === 'OWNER' || ctx.role === 'ADMIN' || ctx.role === 'SUPER_ADMIN',
    },
  };

  return <PipelineRunner initial={initial} pipelineId={id} />;
}
