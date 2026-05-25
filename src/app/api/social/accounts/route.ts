import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const createSchema = z.object({
  platform: z.enum(['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST']),
  type: z.enum(['PROFILE', 'PAGE', 'BUSINESS', 'CHANNEL', 'GROUP']).default('PROFILE'),
  externalId: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  brandId: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const accounts = await db.socialAccount.findMany({
    where: { organizationId: ctx.organizationId },
    include: { brand: true, pages: true, _count: { select: { tokens: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(accounts);
});

/**
 * MOCK CONNECT. In MVP we let users register a social account manually (or via /api/social/connect OAuth start).
 * In real mode this endpoint is called BY the OAuth callback handler with a freshly received token.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');
  const body = createSchema.parse(await req.json());

  const account = await db.socialAccount.upsert({
    where: { platform_externalId: { platform: body.platform, externalId: body.externalId } },
    update: {
      organizationId: ctx.organizationId,
      handle: body.handle,
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
      brandId: body.brandId,
      permissions: body.permissions ?? [],
      status: 'CONNECTED',
    },
    create: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      platform: body.platform,
      type: body.type,
      externalId: body.externalId,
      handle: body.handle,
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
      permissions: body.permissions ?? [],
      status: 'CONNECTED',
    },
  });
  return created(account);
});
