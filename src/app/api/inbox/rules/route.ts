import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { InteractionSentiment, InteractionType } from '@prisma/client';

const sentimentEnum = z.nativeEnum(InteractionSentiment);
const typeEnum = z.nativeEnum(InteractionType);

const createSchema = z.object({
  brandId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  allowedSentiments: z.array(sentimentEnum).optional(),
  allowedTypes: z.array(typeEnum).optional(),
  customPromptFragment: z.string().nullable().optional(),
  minSentimentScore: z.number().min(-1).max(1).optional(),
  maxReplyLength: z.number().int().min(50).max(500).optional(),
  requireApproval: z.boolean().optional(),
  dailyCap: z.number().int().min(0).max(1000).optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const rules = await db.autoReplyRule.findMany({
    where: { organizationId: ctx.organizationId },
    include: { brand: { select: { id: true, name: true } } },
    orderBy: [{ brandId: 'asc' }, { createdAt: 'asc' }],
  });
  return ok(rules);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const body = createSchema.parse(await req.json());

  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!brand) throw new ValidationError('Marque inconnue dans cette organisation');
  }

  const rule = await db.autoReplyRule.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId ?? null,
      enabled: body.enabled ?? false,
      allowedSentiments: body.allowedSentiments ?? [InteractionSentiment.POSITIVE],
      allowedTypes: body.allowedTypes ?? [InteractionType.COMMENT, InteractionType.MENTION],
      customPromptFragment: body.customPromptFragment ?? null,
      minSentimentScore: body.minSentimentScore ?? 0.3,
      maxReplyLength: body.maxReplyLength ?? 280,
      requireApproval: body.requireApproval ?? true,
      dailyCap: body.dailyCap ?? 20,
    },
    include: { brand: { select: { id: true, name: true } } },
  });
  return created(rule);
});
