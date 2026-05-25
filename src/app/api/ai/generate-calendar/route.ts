import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';

const schema = z.object({
  brandId: z.string(),
  daysCount: z.number().int().min(1).max(31).default(7),
  platforms: z.array(z.string()).default(['INSTAGRAM']),
  themes: z.array(z.string()).optional(),
  language: z.string().default('fr'),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  const brand = await db.brand.findFirst({
    where: { id: body.brandId, organizationId: ctx.organizationId },
    include: { profile: true },
  });
  if (!brand) throw new Error('Brand not found');

  const suggestions = await AIProviderService.generateCalendar({
    brandContext: {
      name: brand.name,
      slogan: brand.profile?.slogan,
      mission: brand.profile?.mission,
      values: brand.profile?.values ?? [],
      audienceTarget: brand.profile?.audienceTarget,
      toneOfVoice: brand.profile?.toneOfVoice,
      officialHashtags: brand.profile?.officialHashtags ?? [],
    },
    daysCount: body.daysCount,
    platforms: body.platforms,
    themes: body.themes,
    language: body.language,
  });

  return ok({ suggestions });
});
