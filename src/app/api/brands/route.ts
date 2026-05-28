import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { slugify } from '@/lib/utils';
import { ValidationError } from '@/lib/errors';

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

  // Compute a unique slug per org — auto-suffix if collision
  const baseSlug = slugify(body.name) || 'brand';
  let slug = baseSlug;
  let suffix = 1;
  while (await db.brand.findFirst({ where: { organizationId: ctx.organizationId, slug }, select: { id: true } })) {
    slug = `${baseSlug}-${suffix++}`;
    if (suffix > 50) {
      throw new ValidationError(`Trop de marques avec ce nom dans cette organisation`);
    }
  }

  // Check name collision (case-insensitive) — friendlier message than relying on DB
  const sameNameExists = await db.brand.findFirst({
    where: {
      organizationId: ctx.organizationId,
      name: { equals: body.name, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
  if (sameNameExists) {
    throw new ValidationError(`Une marque nommée "${sameNameExists.name}" existe déjà dans cette organisation. Choisis un nom différent ou ouvre l'existante.`);
  }

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
