import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { slugify } from '@/lib/utils';

const createSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  description: z.string().optional(),
  clientId: z.string().optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const brands = await db.brand.findMany({
    where: { organizationId: ctx.organizationId },
    include: { profile: true, client: true, _count: { select: { posts: true, socialAccounts: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(brands);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'brand.manage');
  const body = createSchema.parse(await req.json());
  const slug = slugify(body.name);
  const brand = await db.brand.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name,
      slug,
      industry: body.industry,
      description: body.description,
      clientId: body.clientId,
      profile: { create: {} },
    },
    include: { profile: true },
  });
  return created(brand);
});
