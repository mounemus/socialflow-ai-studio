import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveStrategyItemContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

// L'action « execute » génère désormais le texte final via l'IA (~10-20 s) —
// la limite par défaut de la fonction était trop courte.
export const maxDuration = 120;

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reset', 'execute']),
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  platform: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  suggestedDate: z.string().nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().nullable().optional(),
});

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { userId, organizationId, role } = await resolveStrategyItemContext(id);
  requirePermission(role, 'campaign.manage');
  const body = actionSchema.parse(await req.json());

  if (body.action === 'execute') {
    const result = await MarketingStrategyService.executeItem(id, organizationId, userId);
    return ok(result);
  }
  const statusMap = { approve: 'APPROVED', reject: 'REJECTED', reset: 'PROPOSED' } as const;
  const updated = await MarketingStrategyService.updateItemStatus(id, organizationId, statusMap[body.action]);
  return ok(updated);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role } = await resolveStrategyItemContext(id);
  requirePermission(role, 'campaign.manage');
  const body = patchSchema.parse(await req.json());
  const updated = await MarketingStrategyService.updateItemContent(id, organizationId, body);
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { item, role } = await resolveStrategyItemContext(id);
  requirePermission(role, 'campaign.manage');
  if (item.status === 'EXECUTED') throw new ForbiddenError('Cannot delete executed item');
  await db.strategyItem.delete({ where: { id } });
  return ok({ deleted: true });
});
