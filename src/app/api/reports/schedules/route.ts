import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant, requireBrand } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ReportingService } from '@/services/reporting/ReportingService';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().min(1),
  brandId: z.string().optional(),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY']),
  period: z.enum(['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'LAST_12_MONTHS', 'CUSTOM']),
  sections: z.array(z.string()).min(1),
  whiteLabel: z.record(z.string(), z.unknown()).optional(),
  recipients: z.array(z.string().email()).min(1),
});

export const GET = handle(async (_req) => {
  const ctx = await requireTenant();
  const schedules = await db.reportSchedule.findMany({
    where: { organizationId: ctx.organizationId },
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(schedules);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = createSchema.parse(await req.json());

  if (body.brandId) {
    await requireBrand(ctx, body.brandId);
  }

  const nextRunAt = ReportingService.computeNextRun(body.frequency);

  const schedule = await db.reportSchedule.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId ?? null,
      title: body.title,
      frequency: body.frequency,
      period: body.period,
      sections: body.sections,
      whiteLabel: (body.whiteLabel ?? undefined) as never,
      recipients: body.recipients,
      nextRunAt,
    },
  });

  return created(schedule);
});
