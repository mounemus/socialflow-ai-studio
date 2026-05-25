import { z } from 'zod';
import { handle, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { CanvaService } from '@/services/canva/CanvaService';

const schema = z.object({
  postId: z.string(),
  canvaUrl: z.string().url(),
  brandId: z.string().optional(),
  previewUrl: z.string().url().optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = schema.parse(await req.json());
  await CanvaService.attachDesignToPost({ ...body, organizationId: ctx.organizationId });
  return created({ attached: true });
});
