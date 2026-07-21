import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolvePipelineContext(id);
  const run = await db.brandPipelineRun.findUnique({
    where: { id },
    include: {
      brand: true,
      strategy: { include: { items: { orderBy: { order: 'asc' } } } },
      startedBy: { select: { id: true, name: true, email: true } },
      approvedProfileBy: { select: { id: true, name: true, email: true } },
      approvedStrategyBy: { select: { id: true, name: true, email: true } },
    },
  });
  return ok(run);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');

  // Runs zombies (aucune marque créée) et runs terminés : suppression réelle —
  // il n'y a rien à préserver et ils encombrent la liste.
  const run = await db.brandPipelineRun.findUnique({
    where: { id },
    select: { status: true, brandId: true },
  });
  const isTerminal =
    run && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status);
  const isZombie = run && !run.brandId;
  if (isTerminal || isZombie) {
    await db.brandPipelineRun.delete({ where: { id } });
    return ok({ deleted: true });
  }

  await BrandPipelineService.cancel(id, userId);
  return ok({ cancelled: true });
});
