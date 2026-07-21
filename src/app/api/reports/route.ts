import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant, requireBrand } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().min(1),
  brandId: z.string().optional(),
  period: z.enum(['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'LAST_12_MONTHS', 'CUSTOM']),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  sections: z.array(z.string()).min(1),
  whiteLabel: z.record(z.string(), z.unknown()).optional(),
});

export const GET = handle(async (_req) => {
  const ctx = await requireTenant();
  // `data` (rapport calculé complet) n'est lu que sur la page de détail.
  const reports = await db.report.findMany({
    where: { organizationId: ctx.organizationId },
    omit: { data: true },
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok(reports);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = createSchema.parse(await req.json());

  if (body.brandId) {
    await requireBrand(ctx, body.brandId);
  }

  const report = await db.report.create({
    data: {
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
      brandId: body.brandId ?? null,
      title: body.title,
      period: body.period,
      periodStart: body.periodStart ? new Date(body.periodStart) : null,
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
      sections: body.sections,
      whiteLabel: (body.whiteLabel ?? undefined) as never,
      status: 'DRAFT',
    },
  });

  return created(report);
});
