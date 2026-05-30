import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

const schema = z.object({
  stepName: z.string().min(1),
  feedback: z.string().min(1),
});

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');
  const body = schema.parse(await req.json());

  const result = await BrandPipelineService.rejectStep(id, body.stepName, body.feedback, userId);
  return ok(result);
});
