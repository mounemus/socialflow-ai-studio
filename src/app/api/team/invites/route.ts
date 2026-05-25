import { z } from 'zod';
import crypto from 'node:crypto';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';

const schema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']).default('EDITOR'),
});

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const invites = await db.teamInvite.findMany({
    where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
    include: { invitedBy: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(invites);
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');
  const body = schema.parse(await req.json());

  const existing = await db.user.findUnique({ where: { email: body.email } });
  if (existing) {
    const alreadyMember = await db.teamMember.findUnique({
      where: { userId_organizationId: { userId: existing.id, organizationId: ctx.organizationId } },
    });
    if (alreadyMember) throw new ValidationError('User is already a member of this organization');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);

  const invite = await db.teamInvite.upsert({
    where: { organizationId_email: { organizationId: ctx.organizationId, email: body.email } },
    update: { role: body.role, token, expiresAt, revokedAt: null, acceptedAt: null, invitedById: ctx.userId },
    create: {
      organizationId: ctx.organizationId,
      email: body.email,
      role: body.role,
      token,
      expiresAt,
      invitedById: ctx.userId,
    },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://socialflow-ai-studio.vercel.app';
  return created({ ...invite, acceptUrl: `${base}/accept-invite?token=${token}` });
});
