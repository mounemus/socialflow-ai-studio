import { z } from 'zod';
import { cookies } from 'next/headers';
import { handle, ok } from '@/lib/api';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';

const schema = z.object({ organizationId: z.string() });

export const POST = handle(async (req) => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();
  const body = schema.parse(await req.json());

  const membership = await db.teamMember.findUnique({
    where: { userId_organizationId: { userId, organizationId: body.organizationId } },
  });
  if (!membership) {
    // Allow SUPER_ADMIN to act in any org
    const user = await db.user.findUnique({ where: { id: userId }, select: { globalRole: true } });
    if (user?.globalRole !== 'SUPER_ADMIN') throw new ForbiddenError('Not a member of this org');
  }

  const c = await cookies();
  c.set('active_org_id', body.organizationId, {
    httpOnly: false,        // readable by client to display in UI
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 3600,
    path: '/',
  });
  return ok({ activeOrganizationId: body.organizationId });
});

export const GET = handle(async () => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();
  const c = await cookies();
  const active = c.get('active_org_id')?.value;
  const memberships = await db.teamMember.findMany({
    where: { userId },
    include: { organization: { select: { id: true, name: true, slug: true, plan: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return ok({
    activeOrganizationId: active ?? memberships[0]?.organizationId ?? null,
    organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
  });
});
