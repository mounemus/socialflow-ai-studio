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
    httpOnly: true,         // server-only read; shrinks XSS surface
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

  // Validate the cookie against actual memberships. If stale, clear it and
  // fall back to the oldest membership so the chip and the server-rendered
  // hero card agree on a single source of truth.
  let resolved: string | null = active ?? null;
  if (active) {
    const isMember = memberships.some((m) => m.organizationId === active);
    if (!isMember) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { globalRole: true } });
      if (user?.globalRole !== 'SUPER_ADMIN') {
        c.delete('active_org_id');
        resolved = memberships[0]?.organizationId ?? null;
      }
    }
  } else {
    resolved = memberships[0]?.organizationId ?? null;
  }

  return ok({
    activeOrganizationId: resolved,
    organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
  });
});

export const DELETE = handle(async () => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError();
  const c = await cookies();
  c.delete('active_org_id');
  return ok({ cleared: true });
});
