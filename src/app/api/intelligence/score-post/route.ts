import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, resolvePostContext } from '@/lib/tenant';
import { ContentScoringService } from '@/services/intelligence/ContentScoringService';

const inlineSchema = z.object({
  body: z.string().min(5),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional().nullable(),
  platform: z.string().optional(),
  format: z.string().optional(),
  language: z.string().optional(),
  brandId: z.string().optional().nullable(),
});

const refSchema = z.object({ postId: z.string() });

/**
 * Score a piece of content — either provided inline OR by postId.
 * Returns a 6-dimension breakdown, top suggestions, risk flags.
 */
export const POST = handle(async (req) => {
  const json = (await req.json()) as Record<string, unknown>;

  if (typeof json.postId === 'string') {
    const { postId } = refSchema.parse(json);
    const { post } = await resolvePostContext(postId);
    const score = await ContentScoringService.score({
      body: post.body ?? '',
      hashtags: post.hashtags,
      cta: post.cta,
      format: post.format,
      language: post.language,
      brandId: post.brandId,
    });
    await ContentScoringService.logScore({ postId, score });
    return ok(score);
  }

  await requireTenant();
  const input = inlineSchema.parse(json);
  const score = await ContentScoringService.score(input);
  return ok(score);
});
