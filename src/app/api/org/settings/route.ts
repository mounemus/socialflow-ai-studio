import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  requireApproval: z.boolean(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { settings: true },
  });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  return ok({ requireApproval: settings.requireApproval === true });
});

export const PATCH = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');
  const body = patchSchema.parse(await req.json());

  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { settings: true },
  });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const updated = await db.organization.update({
    where: { id: ctx.organizationId },
    data: { settings: { ...settings, requireApproval: body.requireApproval } },
    select: { settings: true },
  });

  return ok({ requireApproval: (updated.settings as Record<string, unknown>).requireApproval === true });
});
