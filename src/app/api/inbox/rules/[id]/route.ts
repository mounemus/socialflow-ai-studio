import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { NotFoundError } from '@/lib/errors';
import { db } from '@/lib/db';
import { InteractionSentiment, InteractionType } from '@prisma/client';

const sentimentEnum = z.nativeEnum(InteractionSentiment);
const typeEnum = z.nativeEnum(InteractionType);

const patchSchema = z.object({
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

async function loadRule(id: string, organizationId: string) {
  const rule = await db.autoReplyRule.findFirst({
    where: { id, organizationId },
  });
  if (!rule) throw new NotFoundError('Auto-reply rule not found');
  return rule;
}

export const PATCH = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const { id } = await params;
  await loadRule(id, ctx.organizationId);
  const body = patchSchema.parse(await req.json());

  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!brand) throw new NotFoundError('Brand not in this organization');
  }

  const data: Record<string, unknown> = {};
  if (body.brandId !== undefined) data.brandId = body.brandId;
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.allowedSentiments !== undefined) data.allowedSentiments = body.allowedSentiments as never;
  if (body.allowedTypes !== undefined) data.allowedTypes = body.allowedTypes as never;
  if (body.customPromptFragment !== undefined) data.customPromptFragment = body.customPromptFragment;
  if (body.minSentimentScore !== undefined) data.minSentimentScore = body.minSentimentScore;
  if (body.maxReplyLength !== undefined) data.maxReplyLength = body.maxReplyLength;
  if (body.requireApproval !== undefined) data.requireApproval = body.requireApproval;
  if (body.dailyCap !== undefined) data.dailyCap = body.dailyCap;

  const updated = await db.autoReplyRule.update({
    where: { id },
    data: data as never,
    include: { brand: { select: { id: true, name: true } } },
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'automation.manage');
  const { id } = await params;
  await loadRule(id, ctx.organizationId);
  await db.autoReplyRule.delete({ where: { id } });
  return ok({ deleted: true });
});
