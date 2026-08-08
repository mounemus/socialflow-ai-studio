import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { OutreachService } from '@/services/outreach/OutreachService';

export const maxDuration = 60;

/** POST /api/outreach/[id]/send — envoie les destinataires en attente. */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const outreach = await db.outreachCampaign.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!outreach) throw new NotFoundError('Campagne introuvable');
  const report = await OutreachService.sendCampaign(id, ctx.userId);
  return ok(report);
});
