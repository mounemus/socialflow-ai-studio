import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, requireCampaign } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  objective: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await requireCampaign(ctx, id);
  const body = patchSchema.parse(await req.json());
  const campaign = await db.campaign.update({ where: { id }, data: body });
  return ok(campaign);
});

/** Les posts liés survivent (Post.campaignId -> SetNull au niveau du schéma). */
export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  await requireCampaign(ctx, id);
  await db.campaign.delete({ where: { id } });
  return ok({ deleted: true });
});
