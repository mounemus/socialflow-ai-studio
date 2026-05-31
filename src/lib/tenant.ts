import { auth } from './auth';
import { db } from './db';
import { UnauthorizedError, NotFoundError, ForbiddenError } from './errors';
import { cookies } from 'next/headers';
import type { Prisma, UserRole } from '@prisma/client';

/**
 * Resolve the current authenticated user + their active organization membership.
 * Every API handler that touches tenant data MUST go through this guard.
 *
 * Active org resolution order:
 *   1. Explicit orgIdHint (from caller)
 *   2. active_org_id cookie (set when user switches org via UI)
 *   3. First membership chronologically (fallback)
 *
 * For resource-scoped operations (brand/post/etc.) prefer resolveBrandContext()
 * etc. which derives the org from the resource itself — eliminates wrong-org bugs.
 */
export type TenantContext = {
  userId: string;
  organizationId: string;
  role: UserRole;
};

async function activeOrgIdFromCookie(): Promise<string | undefined> {
  try {
    const c = await cookies();
    return c.get('active_org_id')?.value;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the active membership for a user in the same order as requireTenant():
 *   1. active_org_id cookie
 *   2. first membership ordered by createdAt
 * Returns null if the user has no membership at all OR if userId is missing.
 * Use this from server components instead of `db.teamMember.findFirst({ where: { userId } })`
 * to keep server-rendered pages in sync with the API's tenant resolution.
 *
 * Two overloads so TS infers the include result correctly.
 */
export function getActiveMembership(
  userId: string | undefined
): Promise<Prisma.TeamMemberGetPayload<Record<string, never>> | null>;
export function getActiveMembership<T extends Prisma.TeamMemberInclude>(
  userId: string | undefined,
  options: { include: T }
): Promise<Prisma.TeamMemberGetPayload<{ include: T }> | null>;
export async function getActiveMembership(
  userId: string | undefined,
  options?: { include?: Prisma.TeamMemberInclude }
): Promise<unknown> {
  if (!userId) return null;
  const cookieOrgId = await activeOrgIdFromCookie();
  if (cookieOrgId) {
    const m = await db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: cookieOrgId } },
      include: options?.include,
    });
    if (m) return m;
  }
  return db.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: options?.include,
  });
}

export async function requireTenant(orgIdHint?: string): Promise<TenantContext> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const candidates: (string | undefined)[] = [orgIdHint, await activeOrgIdFromCookie()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const m = await db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: candidate } },
    });
    if (m) return { userId, organizationId: m.organizationId, role: m.role };
  }

  const m = await db.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  if (!m) throw new ForbiddenError('No organization membership');
  return { userId, organizationId: m.organizationId, role: m.role };
}

export async function requireBrand(ctx: TenantContext, brandId: string) {
  const brand = await db.brand.findFirst({
    where: { id: brandId, organizationId: ctx.organizationId },
  });
  if (!brand) throw new NotFoundError('Brand not found');
  return brand;
}

/**
 * Resolve tenant context from a brand id — derives org from the brand itself,
 * then verifies the current user is a member of that org. SUPER_ADMIN always passes.
 * Use this for brand-scoped endpoints (PATCH/DELETE on a specific brand).
 */
export async function resolveBrandContext(brandId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const brand = await db.brand.findUnique({
    where: { id: brandId },
    include: { organization: true },
  });
  if (!brand) throw new NotFoundError('Brand not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: brand.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this brand\'s organization');
  }

  return {
    userId,
    organizationId: brand.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole, // SA bypass = ADMIN locally
    brand,
    isSuperAdmin,
  };
}

/**
 * Resolve tenant context from a strategy id — derives org from the strategy itself.
 */
export async function resolveStrategyContext(strategyId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const strategy = await db.marketingStrategy.findUnique({ where: { id: strategyId } });
  if (!strategy) throw new NotFoundError('Strategy not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: strategy.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this strategy\'s organization');
  }

  return {
    userId,
    organizationId: strategy.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole,
    strategy,
    isSuperAdmin,
  };
}

/**
 * Resolve tenant context from a strategy ITEM id — derives org via strategy.
 */
export async function resolveStrategyItemContext(itemId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const item = await db.strategyItem.findUnique({
    where: { id: itemId },
    include: { strategy: true },
  });
  if (!item) throw new NotFoundError('Item not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: item.strategy.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this item\'s organization');
  }

  return {
    userId,
    organizationId: item.strategy.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole,
    item,
    strategy: item.strategy,
    isSuperAdmin,
  };
}

/**
 * Resolve tenant context from a schedule id — derives org via post.
 */
export async function resolveScheduleContext(scheduleId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const schedule = await db.postSchedule.findUnique({
    where: { id: scheduleId },
    include: { post: true },
  });
  if (!schedule) throw new NotFoundError('Schedule not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: schedule.post.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this schedule\'s organization');
  }

  return {
    userId,
    organizationId: schedule.post.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole,
    schedule,
    isSuperAdmin,
  };
}

/**
 * Resolve tenant context from a brand pipeline run id — derives org from the run itself,
 * then verifies the current user is a member of that org. SUPER_ADMIN always passes.
 * Mirrors resolveStrategyContext exactly.
 */
export async function resolvePipelineContext(pipelineId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const pipeline = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
  if (!pipeline) throw new NotFoundError('Pipeline not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: pipeline.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this pipeline\'s organization');
  }

  return {
    userId,
    organizationId: pipeline.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole,
    pipeline,
    isSuperAdmin,
  };
}

/**
 * Resolve tenant context from a social interaction id — derives org from the
 * interaction itself, then verifies the current user is a member of that org.
 * SUPER_ADMIN always passes. Mirrors resolvePostContext exactly.
 */
export async function resolveInteractionContext(interactionId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const interaction = await db.socialInteraction.findUnique({
    where: { id: interactionId },
  });
  if (!interaction) throw new NotFoundError('Interaction not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: interaction.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this interaction\'s organization');
  }

  return {
    userId,
    organizationId: interaction.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole,
    interaction,
    isSuperAdmin,
  };
}

/**
 * Resolve tenant context from a post id — same pattern as resolveBrandContext.
 */
export async function resolvePostContext(postId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();

  const post = await db.post.findUnique({ where: { id: postId } });
  if (!post) throw new NotFoundError('Post not found');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: post.organizationId } },
    }),
  ]);

  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';
  if (!membership && !isSuperAdmin) {
    throw new ForbiddenError('Not a member of this post\'s organization');
  }

  return {
    userId,
    organizationId: post.organizationId,
    role: (membership?.role ?? 'ADMIN') as UserRole,
    post,
    isSuperAdmin,
  };
}
