import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';

const schema = z.object({
  prompt: z.string().min(3).max(2000),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9']).default('1:1'),
  styleHint: z.string().optional(),
  variants: z.number().int().min(1).max(4).default(1),
  brandId: z.string().optional(),
  saveToMediaLibrary: z.boolean().default(true),
});

export const maxDuration = 90;

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  // Optional brand context: enrich the prompt with brand visual style
  let enrichedPrompt = body.prompt;
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      include: { profile: true },
    });
    if (brand?.profile?.visualStyle) {
      enrichedPrompt = `${body.prompt}, ${brand.profile.visualStyle}`;
    }
  }

  const start = Date.now();
  const results = [];

  // Generate variants in parallel
  const promises = Array.from({ length: body.variants }, () =>
    AIProviderService.generateImage({
      prompt: enrichedPrompt,
      aspectRatio: body.aspectRatio,
      styleHint: body.styleHint,
    }).catch((err) => ({ url: '', provider: 'error', mocked: false, error: (err as Error).message })),
  );

  const generated = await Promise.all(promises);

  for (const g of generated) {
    if ('error' in g || !g.url) {
      results.push({ ok: false, error: ('error' in g ? g.error : 'Empty URL') });
      continue;
    }
    let mediaId: string | undefined;
    if (body.saveToMediaLibrary && !g.url.startsWith('data:')) {
      // Only save HTTP URLs (skip data: URLs which would explode the DB row)
      const media = await db.mediaAsset.create({
        data: {
          organizationId: ctx.organizationId,
          brandId: body.brandId,
          kind: 'IMAGE',
          url: g.url,
          source: 'ai',
          mimeType: 'image/png',
          altText: body.prompt.slice(0, 200),
          metadata: { prompt: body.prompt, provider: g.provider, aspectRatio: body.aspectRatio } as never,
        },
      });
      mediaId = media.id;
    }
    results.push({
      ok: true,
      url: g.url,
      provider: g.provider,
      mocked: g.mocked,
      mediaId,
    });
  }

  // Log to AI requests for cost tracking
  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'IMAGE',
      prompt: body.prompt,
      response: JSON.stringify(results.map((r) => ({ ok: r.ok, provider: 'provider' in r ? r.provider : null }))).slice(0, 1000),
      durationMs: Date.now() - start,
      success: results.some((r) => r.ok),
      metadata: { variants: body.variants, aspectRatio: body.aspectRatio } as never,
    },
  });

  return ok({
    images: results,
    durationMs: Date.now() - start,
    promptUsed: enrichedPrompt,
  });
});
