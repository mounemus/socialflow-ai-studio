import { z } from 'zod';
import { cookies } from 'next/headers';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

/**
 * Contexte de marque global (Refonte Phase A).
 *
 * Miroir exact de /api/me/active-org : cookie httpOnly `active_brand_id`,
 * validé contre l'organisation active. `null` = mode « Toutes les marques »
 * (vue agence). Les pages serveur lisent le cookie via getActiveBrandId().
 */
const schema = z.object({ brandId: z.string().nullable() });

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = schema.parse(await req.json());
  const c = await cookies();

  if (body.brandId === null) {
    // Mode « Toutes les marques »
    c.delete('active_brand_id');
    return ok({ activeBrandId: null });
  }

  const brand = await db.brand.findUnique({
    where: { id: body.brandId },
    select: { id: true, organizationId: true },
  });
  if (!brand || brand.organizationId !== ctx.organizationId) {
    throw new ForbiddenError('Marque introuvable dans cette organisation');
  }

  c.set('active_brand_id', brand.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 3600,
    path: '/',
  });
  return ok({ activeBrandId: brand.id });
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const c = await cookies();
  const cookieBrandId = c.get('active_brand_id')?.value ?? null;

  const brands = await db.brand.findMany({
    where: { organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      industry: true,
      description: true,
      website: true,
      profile: { select: { audienceTarget: true } },
    },
    orderBy: { name: 'asc' },
    take: 200,
  });

  // Cookie périmé (marque supprimée / autre organisation) → mode « Toutes ».
  let resolved: string | null = cookieBrandId;
  if (cookieBrandId && !brands.some((b) => b.id === cookieBrandId)) {
    c.delete('active_brand_id');
    resolved = null;
  }

  return ok({ activeBrandId: resolved, brands });
});
