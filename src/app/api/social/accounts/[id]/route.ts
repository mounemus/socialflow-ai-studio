import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

const patchSchema = z.object({
  // `null` = détacher le compte de toute marque (utilisable par toutes).
  brandId: z.string().nullable().optional(),
  displayName: z.string().min(1).optional(),
});

/**
 * PATCH /api/social/accounts/[id] — réassigne un compte social à une marque
 * (ou le détache). Permet de connecter une fois via Zernio au niveau org, puis
 * de distribuer chaque compte/page à la bonne marque.
 */
export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');

  const account = await db.socialAccount.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!account) throw new NotFoundError('Social account not found in this organization');

  const body = patchSchema.parse(await req.json());

  // Si une marque est fournie, vérifier qu'elle appartient à l'organisation.
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!brand) throw new NotFoundError('Brand not found in this organization');
  }

  const updated = await db.socialAccount.update({
    where: { id },
    data: {
      ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
      ...(body.displayName ? { displayName: body.displayName } : {}),
    },
    include: { brand: true },
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');
  const account = await db.socialAccount.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!account) throw new NotFoundError('Social account not found in this organization');
  await db.socialAccount.delete({ where: { id } });
  return ok({ deleted: true });
});
