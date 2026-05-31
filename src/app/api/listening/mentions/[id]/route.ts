import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { handle, ok } from '@/lib/api';
import { resolveMentionContext } from '@/lib/tenant';
import { db } from '@/lib/db';

/**
 * PATCH /api/listening/mentions/[id]
 * Update a mention's triage status (NEW/REVIEWED/RESPONDED/IGNORED) and/or
 * override its sentiment. Org is derived from the mention itself
 * (mention → org) — multi-tenant safe.
 */
const patchSchema = z
  .object({
    status: z.enum(['NEW', 'REVIEWED', 'RESPONDED', 'IGNORED']).optional(),
    sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED', 'UNKNOWN']).optional(),
  })
  .refine((b) => b.status !== undefined || b.sentiment !== undefined, {
    message: 'Provide status and/or sentiment',
  });

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  await resolveMentionContext(id);
  const body = patchSchema.parse(await req.json());

  const data: Prisma.BrandMentionUpdateInput = {};
  if (body.status !== undefined) data.status = body.status as never;
  if (body.sentiment !== undefined) data.sentiment = body.sentiment as never;

  const updated = await db.brandMention.update({ where: { id }, data });
  return ok(updated);
});
