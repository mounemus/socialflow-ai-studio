import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ instruction: z.string().max(500).optional() });

/**
 * POST /api/pipelines/[id]/items/[itemId]/regenerate — régénération IA d'un
 * item de stratégie (Acte 3). Retourne le drapeau mocked (honnêteté).
 */
export const POST = handle(async (req, { params }) => {
  const { id, itemId } = await params;
  const { role } = await resolvePipelineContext(id);
  requirePermission(role, 'ai.use');
  const body = schema.parse(await req.json().catch(() => ({})));
  const res = await BrandPipelineService.regenerateItem(id, itemId, body.instruction);
  if (!res.success) throw new Error(res.reason ?? 'Régénération impossible');
  return ok({ itemId, ...res.data });
});
