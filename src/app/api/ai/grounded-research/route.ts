import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { GeminiService } from '@/services/ai/GeminiService';
import { db } from '@/lib/db';

const schema = z.object({
  query: z.string().min(5).max(500),
});

export const maxDuration = 30;

/**
 * Grounded research via Gemini + Google Search.
 * Returns the answer + cited sources.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  if (!GeminiService.isConfigured()) {
    return ok({ configured: false, message: 'GOOGLE_GEMINI_API_KEY manquant.' });
  }

  const start = Date.now();
  const result = await GeminiService.groundedResearch({ query: body.query });

  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'TEXT',
      prompt: `Grounded research: ${body.query}`,
      response: result.text.slice(0, 2000),
      durationMs: Date.now() - start,
      success: true,
      metadata: { provider: 'gemini-grounded', sourcesCount: result.sources.length } as never,
    },
  });

  return ok({ configured: true, ...result, durationMs: Date.now() - start });
});
