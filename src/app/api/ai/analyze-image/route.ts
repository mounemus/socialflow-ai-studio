import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { GeminiService } from '@/services/ai/GeminiService';

const schema = z.object({
  imageUrl: z.string().url().optional(),
  imageBase64: z.string().optional(),
  prompt: z.string().min(3).optional(),
  mode: z.enum(['describe', 'alt_text', 'brand_audit', 'extract_text', 'custom']).default('describe'),
  brandId: z.string().optional(),
});

const MODE_PROMPTS: Record<string, string> = {
  describe: 'Décris cette image de manière détaillée : sujet, composition, couleurs dominantes, mood, objets/personnes présents. 2-3 phrases.',
  alt_text: 'Génère un texte alternatif (alt-text) court et descriptif pour cette image, optimisé accessibilité. Max 125 caractères.',
  extract_text: 'Extrais tout le texte visible sur cette image en conservant la structure (titre, paragraphes, bullets). Si pas de texte, dis-le.',
};

export const maxDuration = 30;

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  if (!GeminiService.isConfigured()) {
    return ok({ configured: false, message: 'GOOGLE_GEMINI_API_KEY manquant. Configure via /admin/setup/gemini.' });
  }
  if (!body.imageUrl && !body.imageBase64) {
    return ok({ ok: false, error: 'imageUrl ou imageBase64 requis' });
  }

  const start = Date.now();
  let result: { text?: string; parsed?: unknown; sources?: unknown[] };

  if (body.mode === 'brand_audit') {
    if (!body.brandId) {
      return ok({ ok: false, error: 'brandId requis pour brand_audit' });
    }
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      include: { profile: true },
    });
    if (!brand) return ok({ ok: false, error: 'Brand introuvable' });
    const audit = await GeminiService.brandVisualAudit({
      brandName: brand.name,
      primaryColor: brand.profile?.primaryColor ?? undefined,
      visualStyle: brand.profile?.visualStyle ?? undefined,
      imageUrl: body.imageUrl!,
    });
    result = { parsed: audit };
  } else {
    const prompt = body.mode === 'custom' && body.prompt
      ? body.prompt
      : MODE_PROMPTS[body.mode] ?? MODE_PROMPTS.describe;
    result = await GeminiService.analyzeImage({
      imageUrl: body.imageUrl,
      imageBase64: body.imageBase64,
      prompt,
      structured: false,
    });
  }

  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'IMAGE',
      prompt: `Vision (${body.mode}): ${body.prompt ?? body.imageUrl?.slice(0, 100) ?? '?'}`,
      response: JSON.stringify(result).slice(0, 2000),
      durationMs: Date.now() - start,
      success: true,
      metadata: { provider: 'gemini', mode: body.mode } as never,
    },
  });

  return ok({ configured: true, ok: true, result, durationMs: Date.now() - start });
});
