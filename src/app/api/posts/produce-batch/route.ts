import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ConcretizationService } from '@/services/concretization/ConcretizationService';
import {
  ContentProductionService,
  type VisualProvider,
} from '@/services/production/ContentProductionService';
import { logger } from '@/lib/logger';

const ALLOWED_PROVIDERS = ['gemini', 'dalle', 'flux'] as const;

const schema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(50),
  providers: z.array(z.enum(ALLOWED_PROVIDERS)).optional(),
  includeVideo: z.boolean().optional(),
});

export const maxDuration = 300;

type BatchResultEntry = {
  postId: string;
  status: 'ok' | 'failed';
  error?: string;
  variantsCount?: number;
};

/**
 * Split `arr` into consecutive chunks of size `size`.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Produce visuals (+ optional video script) for a single post.
 *
 * If the post originated from a StrategyItem (post.metadata.fromStrategyItem
 * or post.metadata.originStrategyItemId), we route through
 * ConcretizationService.concretizeItem so caption/hashtags/images stay in
 * sync with the item. Otherwise we fall back to a direct
 * ContentProductionService.produceVisualsForPost call.
 */
async function produceOnePost(opts: {
  postId: string;
  organizationId: string;
  userId: string;
  providers?: VisualProvider[];
  includeVideo?: boolean;
}): Promise<{ variantsCount: number }> {
  const post = await db.post.findFirst({
    where: { id: opts.postId, organizationId: opts.organizationId },
    select: { id: true, metadata: true, organizationId: true },
  });
  if (!post) {
    throw new Error('Post not found in organization');
  }

  const meta = (post.metadata as Record<string, unknown> | null) ?? {};
  const fromStrategyItem =
    typeof meta.fromStrategyItem === 'string'
      ? meta.fromStrategyItem
      : typeof meta.originStrategyItemId === 'string'
      ? meta.originStrategyItemId
      : null;

  if (fromStrategyItem) {
    const result = await ConcretizationService.concretizeItem({
      itemId: fromStrategyItem,
      userId: opts.userId,
      forceProvider: opts.providers?.[0],
    });
    return { variantsCount: result.variants.length };
  }

  // Fallback: direct post-only production
  const produced = await ContentProductionService.produceVisualsForPost({
    postId: post.id,
    providers: opts.providers,
  });

  if (opts.includeVideo) {
    try {
      await ContentProductionService.produceVideoScriptForPost({ postId: post.id });
    } catch (err) {
      logger.warn('produce-batch: video script failed', {
        postId: post.id,
        err: (err as Error).message,
      });
    }
  }

  await ContentProductionService.persistProducedAssets({
    postId: post.id,
    variants: produced.variants,
    canvaDesign: produced.canvaDesign,
  });

  return { variantsCount: produced.variants.length };
}

/**
 * POST /api/posts/produce-batch
 *
 * Body:
 *   {
 *     postIds: string[]   // 1..50, scoped to caller's organization
 *     providers?: ('gemini'|'dalle'|'flux')[]   // default ['gemini']
 *     includeVideo?: boolean
 *   }
 *
 * Returns:
 *   {
 *     results: Array<{ postId, status:'ok'|'failed', error?, variantsCount? }>,
 *     summary: { total, ok, failed }
 *   }
 *
 * Foreign post IDs (not owned by the caller's org) are silently dropped
 * before any production work runs.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = schema.parse(raw ?? {});

  const providers = (body.providers ?? ['gemini']) as VisualProvider[];

  // Dedupe IDs while preserving caller order
  const requestedIds = Array.from(new Set(body.postIds));

  // Tenancy filter: keep only posts that belong to the active org
  const owned = await db.post.findMany({
    where: { id: { in: requestedIds }, organizationId: ctx.organizationId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((p) => p.id));
  const targetIds = requestedIds.filter((id) => ownedIds.has(id));

  const results: BatchResultEntry[] = [];

  // Rate-limit: process in chunks of 5 in parallel
  for (const batch of chunk(targetIds, 5)) {
    const settled = await Promise.allSettled(
      batch.map((postId) =>
        produceOnePost({
          postId,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          providers,
          includeVideo: body.includeVideo,
        }),
      ),
    );

    settled.forEach((res, i) => {
      const postId = batch[i];
      if (res.status === 'fulfilled') {
        results.push({
          postId,
          status: 'ok',
          variantsCount: res.value.variantsCount,
        });
      } else {
        const err = res.reason instanceof Error ? res.reason.message : String(res.reason);
        logger.warn('produce-batch: post failed', { postId, err });
        results.push({ postId, status: 'failed', error: err });
      }
    });
  }

  // Surface dropped foreign IDs as explicit failures so the client knows
  // which inputs were ignored.
  for (const id of requestedIds) {
    if (!ownedIds.has(id)) {
      results.push({
        postId: id,
        status: 'failed',
        error: 'Post not found in organization',
      });
    }
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  const failedCount = results.length - okCount;

  return ok({
    results,
    summary: {
      total: results.length,
      ok: okCount,
      failed: failedCount,
    },
  });
});
