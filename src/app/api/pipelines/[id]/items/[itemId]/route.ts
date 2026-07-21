import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';

export const dynamic = 'force-dynamic';

const schema = z.object({
  brief: z.string().optional(), // alias UI de description
  title: z.string().optional(),
  description: z.string().optional(),
  platform: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  suggestedDate: z.string().nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().nullable().optional(),
});

/**
 * PATCH /api/pipelines/[id]/items/[itemId] — édition d'un item de stratégie
 * pendant l'Acte 3. (Route manquante à l'origine — l'UI recevait un 404 HTML.)
 */
export const PATCH = handle(async (req, { params }) => {
  const { id, itemId } = await params;
  const { role, organizationId } = await resolvePipelineContext(id);
  requirePermission(role, 'post.edit');
  const body = schema.parse(await req.json());
  const { brief, ...rest } = body;
  const item = await MarketingStrategyService.updateItemContent(itemId, organizationId, {
    ...rest,
    ...(brief !== undefined ? { description: brief } : {}),
  });
  return ok(item);
});
