import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, resolveBrandContext } from '@/lib/tenant';
import { PostingTimingService } from '@/services/intelligence/PostingTimingService';

const schema = z.object({
  brandId: z.string().optional(),
  platform: z.string(),
  count: z.number().int().min(1).max(20).optional(),
  audienceTimezoneOffsetMinutes: z.number().int().optional(),
  minGapMinutes: z.number().int().min(15).max(1440).optional(),
  startFrom: z.string().datetime().optional(),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  if (body.brandId) await resolveBrandContext(body.brandId);
  else await requireTenant();

  const slots = await PostingTimingService.suggestSlots({
    ...body,
    startFrom: body.startFrom ? new Date(body.startFrom) : undefined,
  });
  return ok({ slots });
});
