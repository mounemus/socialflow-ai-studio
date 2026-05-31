import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, requireBrand } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { ReportingService } from '@/services/reporting/ReportingService';

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  brandId: z.string().nullable().optional(),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY']).optional(),
  period: z.enum(['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'LAST_12_MONTHS', 'CUSTOM']).optional(),
  sections: z.array(z.string()).min(1).optional(),
  whiteLabel: z.record(z.string(), z.unknown()).nullable().optional(),
  recipients: z.array(z.string().email()).min(1).optional(),
  enabled: z.boolean().optional(),
});

/** Org-scoped fetch — multi-tenant safe (never leaks across orgs). */
async function requireScheduleInOrg(id: string, organizationId: string) {
  const schedule = await db.reportSchedule.findFirst({
    where: { id, organizationId },
  });
  if (!schedule) throw new NotFoundError('Report schedule not found');
  return schedule;
}

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await requireScheduleInOrg(id, ctx.organizationId);
  const body = patchSchema.parse(await req.json());

  if (body.brandId) {
    await requireBrand(ctx, body.brandId);
  }

  const updated = await db.reportSchedule.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
      ...(body.frequency !== undefined
        ? { frequency: body.frequency, nextRunAt: ReportingService.computeNextRun(body.frequency) }
        : {}),
      ...(body.period !== undefined ? { period: body.period } : {}),
      ...(body.sections !== undefined ? { sections: body.sections } : {}),
      ...(body.whiteLabel !== undefined ? { whiteLabel: (body.whiteLabel ?? undefined) as never } : {}),
      ...(body.recipients !== undefined ? { recipients: body.recipients } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    },
  });

  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await requireScheduleInOrg(id, ctx.organizationId);
  await db.reportSchedule.delete({ where: { id } });
  return ok({ deleted: true });
});
