import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, resolveBrandContext, resolvePostContext } from '@/lib/tenant';
import { RepurposingService, type RepurposeTarget } from '@/services/intelligence/RepurposingService';

const TARGETS = [
  'INSTAGRAM_POST', 'INSTAGRAM_REEL', 'INSTAGRAM_STORY', 'INSTAGRAM_CAROUSEL',
  'LINKEDIN_POST', 'LINKEDIN_ARTICLE',
  'TWITTER_POST', 'TWITTER_THREAD',
  'TIKTOK_VIDEO', 'YOUTUBE_SHORT',
  'EMAIL_MARKETING', 'VIDEO_SCRIPT',
] as const;

const schema = z.object({
  sourcePostId: z.string().optional(),
  sourceText: z.string().min(20).optional(),
  sourceTitle: z.string().optional(),
  brandId: z.string().optional().nullable(),
  targets: z.array(z.enum(TARGETS)).min(1).max(8),
  language: z.string().optional(),
  applyBrandDNA: z.boolean().optional(),
  persistAsDrafts: z.boolean().optional(),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());

  let organizationId: string;
  let sourceText = body.sourceText;
  let sourceTitle = body.sourceTitle;
  let brandId = body.brandId ?? null;

  if (body.sourcePostId) {
    const { post, organizationId: orgId } = await resolvePostContext(body.sourcePostId);
    organizationId = orgId;
    sourceText = sourceText ?? post.body ?? undefined;
    sourceTitle = sourceTitle ?? post.title ?? undefined;
    brandId = brandId ?? post.brandId;
    if (!sourceText) throw new Error('Source post has no body to repurpose');
  } else if (brandId) {
    const ctx = await resolveBrandContext(brandId);
    organizationId = ctx.organizationId;
  } else {
    const ctx = await requireTenant();
    organizationId = ctx.organizationId;
  }

  if (!sourceText) throw new Error('Provide sourcePostId OR sourceText');

  const variants = await RepurposingService.repurpose({
    sourceText, sourceTitle: sourceTitle ?? undefined,
    brandId,
    targets: body.targets as RepurposeTarget[],
    language: body.language,
    applyBrandDNA: body.applyBrandDNA,
  });

  let persistedIds: string[] = [];
  if (body.persistAsDrafts) {
    persistedIds = await RepurposingService.persistAsDrafts({
      organizationId, brandId, sourcePostId: body.sourcePostId, variants,
    });
  }

  return ok({ variants, persistedIds });
});
