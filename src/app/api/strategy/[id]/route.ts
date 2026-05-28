import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveStrategyContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  status: z.enum(['DRAFT', 'VALIDATED', 'IN_EXECUTION', 'ARCHIVED']).optional(),
  title: z.string().optional(),
});

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolveStrategyContext(id);
  const strategy = await db.marketingStrategy.findUnique({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } }, brand: true, validatedBy: { select: { email: true, name: true } } },
  });
  return ok(strategy);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { userId, role, strategy } = await resolveStrategyContext(id);
  requirePermission(role, 'campaign.manage');
  const body = patchSchema.parse(await req.json());

  const updated = await db.marketingStrategy.update({
    where: { id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(body.status ? {
        status: body.status,
        ...(body.status === 'VALIDATED' && strategy.status !== 'VALIDATED'
          ? { validatedAt: new Date(), validatedById: userId }
          : {}),
      } : {}),
    },
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolveStrategyContext(id);
  requirePermission(role, 'campaign.manage');
  await db.marketingStrategy.delete({ where: { id } });
  return ok({ deleted: true });
});
