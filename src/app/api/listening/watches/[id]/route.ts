import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

const SOURCES = ['TWITTER', 'REDDIT', 'WEB', 'NEWS', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'YOUTUBE', 'BLOG', 'FORUM', 'OTHER'] as const;

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  brandId: z.string().nullish(),
  keywords: z.array(z.string().min(1)).min(1).optional(),
  excludeKeywords: z.array(z.string().min(1)).optional(),
  sources: z.array(z.enum(SOURCES)).min(1).optional(),
  minRelevance: z.number().min(0).max(1).optional(),
  alertOnNegative: z.boolean().optional(),
  alertOnSpike: z.boolean().optional(),
  slackWebhookUrl: z.string().url().nullish(),
  enabled: z.boolean().optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const existing = await db.mentionWatch.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Watch not found');

  let brandId: string | null | undefined;
  if (body.brandId !== undefined) {
    if (body.brandId) {
      const brand = await db.brand.findFirst({
        where: { id: body.brandId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      brandId = brand?.id ?? null;
    } else {
      brandId = null;
    }
  }

  const watch = await db.mentionWatch.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(brandId !== undefined ? { brandId } : {}),
      ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
      ...(body.excludeKeywords !== undefined ? { excludeKeywords: body.excludeKeywords } : {}),
      ...(body.sources !== undefined ? { sources: body.sources as never } : {}),
      ...(body.minRelevance !== undefined ? { minRelevance: body.minRelevance } : {}),
      ...(body.alertOnNegative !== undefined ? { alertOnNegative: body.alertOnNegative } : {}),
      ...(body.alertOnSpike !== undefined ? { alertOnSpike: body.alertOnSpike } : {}),
      ...(body.slackWebhookUrl !== undefined ? { slackWebhookUrl: body.slackWebhookUrl ?? null } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    },
    select: { id: true },
  });

  return ok({ watch });
});

export const DELETE = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'watch.manage');
  const { id } = await params;

  const existing = await db.mentionWatch.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Watch not found');

  await db.mentionWatch.delete({ where: { id: existing.id } });
  return ok({ id: existing.id, deleted: true });
});
