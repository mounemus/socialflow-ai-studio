import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const schema = z.object({
  url: z.string().url(),
  brandId: z.string().optional(),
  kind: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'CANVA_LINK']).default('IMAGE'),
  mimeType: z.string().optional(),
  altText: z.string().optional(),
  source: z.string().optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const media = await db.mediaAsset.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok(media);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'media.upload');
  const body = schema.parse(await req.json());
  const m = await db.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      kind: body.kind,
      url: body.url,
      mimeType: body.mimeType,
      altText: body.altText,
      source: body.source,
    },
  });
  return created(m);
});
