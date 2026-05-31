import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

const SOURCES = ['TWITTER', 'REDDIT', 'WEB', 'NEWS', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'YOUTUBE', 'BLOG', 'FORUM', 'OTHER'] as const;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  brandId: z.string().nullish(),
  keywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  sources: z.array(z.enum(SOURCES)).min(1),
  minRelevance: z.number().min(0).max(1).default(0.5),
  alertOnNegative: z.boolean().default(true),
  alertOnSpike: z.boolean().default(false),
  slackWebhookUrl: z.string().url().nullish(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const rows = await db.mentionWatch.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { updatedAt: 'desc' },
    include: { brand: { select: { id: true, name: true } }, _count: { select: { mentions: true } } },
  });
  return ok({ watches: rows });
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = createSchema.parse(await req.json());

  // Validate brand belongs to the org if provided.
  let brandId: string | null = null;
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    brandId = brand?.id ?? null;
  }

  const watch = await db.mentionWatch.create({
    data: {
      organizationId: ctx.organizationId,
      brandId,
      name: body.name,
      keywords: body.keywords,
      excludeKeywords: body.excludeKeywords,
      sources: body.sources as never,
      minRelevance: body.minRelevance,
      alertOnNegative: body.alertOnNegative,
      alertOnSpike: body.alertOnSpike,
      slackWebhookUrl: body.slackWebhookUrl ?? null,
    },
    select: { id: true },
  });

  return created({ watch });
});
