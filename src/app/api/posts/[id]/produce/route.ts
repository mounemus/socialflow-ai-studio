import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import {
  ContentProductionService,
  type VisualProvider,
} from '@/services/production/ContentProductionService';

const schema = z.object({
  providers: z.array(z.enum(['gemini', 'dalle', 'flux', 'canva'])).optional(),
  maxVariants: z.number().int().min(1).max(3).optional(),
  includeVideoScript: z.boolean().optional(),
});

export const maxDuration = 90;

/**
 * Run the full content-production pipeline for a post:
 *   1. Generate image variants via ContentProductionService.produceVisualsForPost
 *   2. (Optional) Generate a video script via produceVideoScriptForPost
 *   3. Persist the visuals as MediaAsset rows via persistProducedAssets
 *      (also flips post.status → PENDING_APPROVAL).
 *
 * Body: { providers?: ('gemini'|'dalle'|'flux')[], maxVariants?: 1-3, includeVideoScript?: boolean }
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'ai.use');

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});

  const produced = await ContentProductionService.produceVisualsForPost({
    postId: id,
    providers: body.providers as VisualProvider[] | undefined,
    maxVariants: body.maxVariants,
  });

  let videoScript: Awaited<
    ReturnType<typeof ContentProductionService.produceVideoScriptForPost>
  > | null = null;
  if (body.includeVideoScript) {
    videoScript = await ContentProductionService.produceVideoScriptForPost({ postId: id });
  }

  const persisted = await ContentProductionService.persistProducedAssets({
    postId: id,
    variants: produced.variants,
    canvaDesign: produced.canvaDesign,
  });

  return ok({
    variants: produced.variants,
    canvaDesign: produced.canvaDesign,
    videoScript,
    mediaAssetIds: persisted.mediaAssetIds,
    postStatus: persisted.postStatus,
  });
});
