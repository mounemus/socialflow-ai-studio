import { auth } from './auth';
import { db } from './db';
import { ForbiddenError, UnauthorizedError } from './errors';

/**
 * Guard for SUPER_ADMIN-only endpoints/pages.
 * Returns the user record if allowed, else throws.
 */
export async function requireSuperAdmin() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.globalRole !== 'SUPER_ADMIN') {
    throw new ForbiddenError('SUPER_ADMIN required');
  }
  return user;
}

export async function isSuperAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const u = await db.user.findUnique({ where: { id: userId }, select: { globalRole: true } });
  return u?.globalRole === 'SUPER_ADMIN';
}
