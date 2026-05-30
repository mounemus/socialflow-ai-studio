import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

/**
 * Export a downloadable content bundle for a post.
 *
 * MVP: returns a JSON "bundle" (caption + hashtags + image URLs + variants)
 * plus a `downloadUrl` that points back at this same endpoint with `?inline=1`.
 * A future iteration can swap this for a real zip upload to Supabase storage.
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');

  const post = await db.post.findUnique({
    where: { id },
    include: {
      media: true,
      variants: true,
      brand: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!post) {
    // resolvePostContext would have thrown — defensive only.
    return ok(null);
  }

  const imageUrls = post.media
    .filter((m) => m.kind === 'IMAGE' || m.kind === 'VIDEO')
    .map((m) => ({
      kind: m.kind,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      altText: m.altText,
    }));

  const bundle = {
    postId: post.id,
    title: post.title,
    caption: post.body ?? '',
    hashtags: post.hashtags,
    cta: post.cta,
    linkUrl: post.linkUrl,
    language: post.language,
    brand: post.brand,
    media: imageUrls,
    variants: post.variants.map((v) => ({
      id: v.id,
      label: v.label,
      body: v.body,
      hashtags: v.hashtags,
      cta: v.cta,
    })),
    exportedAt: new Date().toISOString(),
  };

  // Build a stable data: URL so a browser can `<a download>` it without a
  // round-trip to object storage. Real implementation will swap this for an
  // S3/Supabase signed URL pointing at a zip.
  const json = JSON.stringify(bundle, null, 2);
  const downloadUrl = `data:application/json;charset=utf-8;base64,${Buffer.from(json, 'utf8').toString('base64')}`;
  const filename = `post-${post.id}.json`;

  return ok({ bundle, downloadUrl, filename });
});
