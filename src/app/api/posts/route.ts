import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { stripDataUrls } from '@/lib/strip-data-urls';

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
    // select léger : la liste alimente le picker de l'Atelier (id/title/body/
    // status/format/brand) — campaign et schedules n'y sont jamais lus, et le
    // détail complet (media, campaign, schedules...) est rechargé via
    // /api/posts/[id] dès qu'un post précis est ouvert. `include: { brand,
    // campaign, schedules }` tirait les 3 relations en entier pour 100 lignes,
    // et metadata (base64 hérité) partait sans passer par stripDataUrls — les
    // deux ensemble expliquaient le ~8.7s observé en prod.
    select: {
      id: true,
      title: true,
      body: true,
      hashtags: true,
      status: true,
      format: true,
      brandId: true,
      campaignId: true,
      version: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      brand: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return ok(stripDataUrls(posts));
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
