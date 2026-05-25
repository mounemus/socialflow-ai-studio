import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const schema = z.object({
  brandId: z.string().optional(),
  name: z.string().min(1),
  website: z.string().url().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const comps = await db.competitor.findMany({
    where: { organizationId: ctx.organizationId },
    include: { socialAccounts: true, _count: { select: { posts: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(comps);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'competitor.manage');
  const body = schema.parse(await req.json());
  const c = await db.competitor.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      name: body.name,
      website: body.website,
      industry: body.industry,
      country: body.country,
      keywords: body.keywords ?? [],
      notes: body.notes,
    },
  });
  return created(c);
});
