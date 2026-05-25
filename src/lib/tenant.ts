import { auth } from './auth';
import { db } from './db';
import { UnauthorizedError, NotFoundError, ForbiddenError } from './errors';
import type { UserRole } from '@prisma/client';

/**
 * Resolve the current authenticated user + their active organization membership.
 * Every API handler that touches tenant data MUST go through this guard.
 */
export type TenantContext = {
  userId: string;
  organizationId: string;
  role: UserRole;
};

export async function requireTenant(orgIdHint?: string): Promise<TenantContext> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  // Pick org from hint or first membership
  const membership = orgIdHint
    ? await db.teamMember.findFirst({ where: { userId, organizationId: orgIdHint } })
    : await db.teamMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });

  if (!membership) throw new ForbiddenError('No organization membership');

  return { userId, organizationId: membership.organizationId, role: membership.role };
}

export async function requireBrand(ctx: TenantContext, brandId: string) {
  const brand = await db.brand.findFirst({
    where: { id: brandId, organizationId: ctx.organizationId },
  });
  if (!brand) throw new NotFoundError('Brand not found');
  return brand;
}
