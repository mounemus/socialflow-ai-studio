import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const createSchema = z.object({
  brandId: z.string().optional(),
  campaignId: z.string().optional(),
  format: z.string(),
  language: z.string().default('fr'),
  title: z.string().optional(),
  body: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
  linkUrl: z.string().url().optional(),
  coverImageUrl: z.string().optional(), // visual from the Design Studio
  status: z.string().default('DRAFT'),
  /** Objectif de la publication — saisi UNE fois (rampe Créer), repris par le Brief du Studio. */
  objective: z.string().max(500).optional(),
});

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const brandId = url.searchParams.get('brandId') ?? undefined;
  const posts = await db.post.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(status ? { status: status as never } : {}),
      ...(brandId ? { brandId } : {}),
    },
    include: { brand: true, campaign: true, schedules: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return ok(posts);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.create');
  const body = createSchema.parse(await req.json());
  const post = await db.post.create({
    data: {
      organizationId: ctx.organizationId,
      authorId: ctx.userId,
      brandId: body.brandId,
      campaignId: body.campaignId,
      format: body.format as never,
      language: body.language,
      title: body.title,
      body: body.body,
      hashtags: body.hashtags ?? [],
      cta: body.cta,
      linkUrl: body.linkUrl,
      status: body.status as never,
      ...(body.coverImageUrl || body.objective
        ? {
            metadata: {
              ...(body.coverImageUrl ? { coverImageUrl: body.coverImageUrl, source: 'design-studio' } : {}),
              ...(body.objective ? { objective: body.objective } : {}),
            } as never,
          }
        : {}),
    },
  });

  // If the cover image is a stored (HTTP) asset, also link it as a MediaAsset.
  if (body.coverImageUrl && body.coverImageUrl.startsWith('http')) {
    await db.mediaAsset.create({
      data: {
        organizationId: ctx.organizationId,
        brandId: body.brandId,
        kind: 'IMAGE',
        url: body.coverImageUrl,
        source: 'design-studio',
        mimeType: 'image/png',
        posts: { connect: { id: post.id } },
      },
    }).catch(() => {});
  }
  return created(post);
});
