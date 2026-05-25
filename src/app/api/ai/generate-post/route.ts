import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';

const schema = z.object({
  brandId: z.string().optional(),
  platform: z.string().optional(),
  format: z.string().optional(),
  language: z.string().default('fr'),
  tone: z.string().optional(),
  audience: z.string().optional(),
  prompt: z.string().min(3),
  cta: z.string().optional(),
  saveAsDraft: z.boolean().default(false),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  let brandContext: Parameters<typeof AIProviderService.generateText>[0]['brandContext'] | undefined;
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      include: { profile: true },
    });
    if (brand) {
      brandContext = {
        name: brand.name,
        slogan: brand.profile?.slogan,
        mission: brand.profile?.mission,
        values: brand.profile?.values ?? [],
        audienceTarget: brand.profile?.audienceTarget,
        toneOfVoice: brand.profile?.toneOfVoice,
        wordsToUse: brand.profile?.wordsToUse ?? [],
        wordsToAvoid: brand.profile?.wordsToAvoid ?? [],
        officialHashtags: brand.profile?.officialHashtags ?? [],
      };
    }
  }

  const start = Date.now();
  const result = await AIProviderService.generateText({
    prompt: body.prompt,
    platform: body.platform,
    format: body.format as never,
    language: body.language,
    tone: body.tone,
    audience: body.audience,
    cta: body.cta,
    brandContext,
  });

  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'TEXT',
      prompt: body.prompt,
      response: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      success: true,
      metadata: { provider: result.provider, mocked: result.mocked },
    },
  });

  let post = null;
  if (body.saveAsDraft) {
    post = await db.post.create({
      data: {
        organizationId: ctx.organizationId,
        authorId: ctx.userId,
        brandId: body.brandId,
        status: 'AI_GENERATED',
        format: (body.format ?? 'INSTAGRAM_POST') as never,
        language: body.language,
        body: result.text,
        hashtags: result.hashtags ?? [],
        cta: body.cta,
        aiPrompt: body.prompt,
        aiProvider: result.provider,
        aiModel: result.model,
      },
    });
  }

  return ok({ ...result, totalMs: Date.now() - start, post });
});
