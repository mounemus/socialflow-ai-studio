import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, requireBrand } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().url().max(2048).nullable().optional(),
  profile: z
    .object({
      slogan: z.string().optional(),
      mission: z.string().optional(),
      values: z.array(z.string()).optional(),
      audienceTarget: z.string().optional(),
      productsServices: z.array(z.string()).optional(),
      toneOfVoice: z.string().optional(),
      wordsToUse: z.array(z.string()).optional(),
      wordsToAvoid: z.array(z.string()).optional(),
      officialHashtags: z.array(z.string()).optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      typography: z.string().max(500).optional(),
      visualStyle: z.string().optional(),
      canvaStyle: z.string().optional(),
    })
    .optional(),
});

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireBrand(ctx, id);
  const brand = await db.brand.findUnique({
    where: { id },
    include: { profile: true, client: true, socialAccounts: true, competitors: true, trendWatches: true },
  });
  return ok(brand);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'brand.manage');
  await requireBrand(ctx, id);
  const body = patchSchema.parse(await req.json());

  const brand = await db.brand.update({
    where: { id },
    data: {
      name: body.name,
      industry: body.industry,
      description: body.description,
      logo: body.logo, // undefined = unchanged, null = cleared
      profile: body.profile
        ? {
            upsert: {
              create: body.profile,
              update: body.profile,
            },
          }
        : undefined,
    },
    include: { profile: true },
  });
  return ok(brand);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'brand.manage');
  await requireBrand(ctx, id);
  await db.brand.delete({ where: { id } });
  return ok({ deleted: true });
});
