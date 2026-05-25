import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

const patchSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
  linkUrl: z.string().url().optional().nullable(),
  status: z.string().optional(),
});

async function findOwned(id: string, organizationId: string) {
  const post = await db.post.findFirst({ where: { id, organizationId } });
  if (!post) throw new NotFoundError('Post not found');
  return post;
}

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  await findOwned(id, ctx.organizationId);
  const post = await db.post.findUnique({
    where: { id },
    include: { brand: true, campaign: true, schedules: true, media: true, canvaDesigns: true, variants: true, approvals: true },
  });
  return ok(post);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');
  await findOwned(id, ctx.organizationId);
  const body = patchSchema.parse(await req.json());
  const data: Record<string, unknown> = { ...body, version: { increment: 1 } };
  if (body.status) data.status = body.status as never;
  const updated = await db.post.update({
    where: { id },
    data: data as never,
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.delete');
  await findOwned(id, ctx.organizationId);
  await db.post.delete({ where: { id } });
  return ok({ deleted: true });
});
