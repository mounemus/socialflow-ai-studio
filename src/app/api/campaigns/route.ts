import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { slugify } from '@/lib/utils';

const schema = z.object({
  brandId: z.string().optional(),
  name: z.string().min(1),
  objective: z.string().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  targetAudience: z.string().optional(),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const campaigns = await db.campaign.findMany({
    where: { organizationId: ctx.organizationId },
    include: { brand: true, _count: { select: { posts: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(campaigns);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = schema.parse(await req.json());
  const c = await db.campaign.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      name: body.name,
      slug: slugify(body.name),
      objective: body.objective,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      targetAudience: body.targetAudience,
    },
  });
  return created(c);
});
