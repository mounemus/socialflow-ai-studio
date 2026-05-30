import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
  linkUrl: z.string().url().optional().nullable(),
  status: z.string().optional(),
  // Shallow-merged into the existing metadata JSON column. Whitelisted keys only —
  // anything else is silently dropped to avoid clients writing arbitrary state.
  metadata: z
    .object({
      coverMediaId: z.string().optional(),
      coverUrl: z.string().optional(),
    })
    .partial()
    .optional(),
});

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolvePostContext(id);
  const post = await db.post.findUnique({
    where: { id },
    include: { brand: true, campaign: true, schedules: true, media: true, canvaDesigns: true, variants: true, approvals: true },
  });
  return ok(post);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  const body = patchSchema.parse(await req.json());
  const data: Record<string, unknown> = { ...body, version: { increment: 1 } };
  if (body.status) data.status = body.status as never;
  if (body.metadata) {
    // Shallow-merge into existing metadata JSON column.
    const existing = await db.post.findUnique({ where: { id }, select: { metadata: true } });
    const merged = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...body.metadata,
    };
    data.metadata = merged as never;
  }
  const updated = await db.post.update({
    where: { id },
    data: data as never,
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.delete');
  await db.post.delete({ where: { id } });
  return ok({ deleted: true });
});
