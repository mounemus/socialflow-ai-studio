import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError, ForbiddenError } from '@/lib/errors';

const patchSchema = z.object({
  status: z.enum(['DRAFT', 'VALIDATED', 'IN_EXECUTION', 'ARCHIVED']).optional(),
  title: z.string().optional(),
});

export const GET = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const strategy = await db.marketingStrategy.findUnique({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } }, brand: true, validatedBy: { select: { email: true, name: true } } },
  });
  if (!strategy) throw new NotFoundError('Strategy not found');
  if (strategy.organizationId !== ctx.organizationId) throw new ForbiddenError();
  return ok(strategy);
});

export const PATCH = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const strategy = await db.marketingStrategy.findUnique({ where: { id } });
  if (!strategy || strategy.organizationId !== ctx.organizationId) throw new NotFoundError('Strategy not found');

  const updated = await db.marketingStrategy.update({
    where: { id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(body.status ? {
        status: body.status,
        ...(body.status === 'VALIDATED' && strategy.status !== 'VALIDATED'
          ? { validatedAt: new Date(), validatedById: ctx.userId }
          : {}),
      } : {}),
    },
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { id } = await params;
  const strategy = await db.marketingStrategy.findUnique({ where: { id } });
  if (!strategy || strategy.organizationId !== ctx.organizationId) throw new NotFoundError('Strategy not found');
  await db.marketingStrategy.delete({ where: { id } });
  return ok({ deleted: true });
});
