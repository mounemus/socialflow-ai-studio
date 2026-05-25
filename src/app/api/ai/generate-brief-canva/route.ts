import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { CanvaService } from '@/services/canva/CanvaService';

const schema = z.object({
  brandId: z.string(),
  format: z.string(),
  topic: z.string(),
  tone: z.string().optional(),
  audience: z.string().optional(),
  cta: z.string().optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = schema.parse(await req.json());
  const brand = await db.brand.findFirst({
    where: { id: body.brandId, organizationId: ctx.organizationId },
    include: { profile: true },
  });
  if (!brand) throw new Error('Brand not found');

  const brief = CanvaService.generateCanvaBrief({
    brandName: brand.name,
    format: body.format,
    topic: body.topic,
    tone: body.tone ?? brand.profile?.toneOfVoice ?? undefined,
    audience: body.audience ?? brand.profile?.audienceTarget ?? undefined,
    cta: body.cta,
    primaryColor: brand.profile?.primaryColor ?? undefined,
    visualStyle: brand.profile?.visualStyle ?? undefined,
  });

  return ok({ brief });
});
