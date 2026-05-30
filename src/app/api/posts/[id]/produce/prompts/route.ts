import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ContentProductionService } from '@/services/production/ContentProductionService';
import { db } from '@/lib/db';

/**
 * Cheap, text-only sibling of /produce: returns the image / video / caption prompts
 * that would be used, WITHOUT calling any image-generation provider.
 *
 * Returns: { imagePrompt, videoPrompt?, captionPrompt, aspectRatio, reasoning?, mocked }
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role, post } = await resolvePostContext(id);
  requirePermission(role, 'ai.use');

  // Optional: pull originating strategy item & brand for richer prompt
  const meta = (post.metadata as Record<string, unknown> | null) ?? {};
  const originId = typeof meta.originStrategyItemId === 'string' ? meta.originStrategyItemId : null;
  const strategyItem = originId
    ? await db.strategyItem.findUnique({ where: { id: originId } })
    : null;
  const brand = post.brandId
    ? await db.brand.findUnique({ where: { id: post.brandId } })
    : null;

  const prompts = await ContentProductionService.generatePromptsForItem({
    item: {
      kind: strategyItem?.kind ?? 'POST_IDEA',
      title: post.title ?? strategyItem?.title ?? null,
      description: post.body ?? strategyItem?.description ?? null,
      platform: strategyItem?.platform ?? null,
      format: post.format,
      cta: post.cta ?? strategyItem?.cta ?? null,
      hashtags: post.hashtags?.length ? post.hashtags : strategyItem?.hashtags ?? null,
    },
    brand: brand ? { id: brand.id, name: brand.name, industry: brand.industry } : null,
  });

  return ok(prompts);
});
