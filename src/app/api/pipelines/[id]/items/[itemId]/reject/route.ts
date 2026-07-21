import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

const schema = z.object({ reason: z.string().max(500).optional() });

/** POST /api/pipelines/[id]/items/[itemId]/reject — rejet d'un item avec feedback (Acte 3). */
export const POST = handle(async (req, { params }) => {
  const { id, itemId } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'post.approve');
  const body = schema.parse(await req.json().catch(() => ({})));
  const res = await BrandPipelineService.rejectItem(
    id,
    itemId,
    body.reason ?? 'Rejeté sans motif détaillé',
    userId,
  );
  if (!res.success) throw new Error(res.reason ?? 'Rejet impossible');
  return ok({ itemId, rejected: true });
});
