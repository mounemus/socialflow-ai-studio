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
  await BrandPipelineService.cancel(id, userId);
  return ok({ cancelled: true });
});
