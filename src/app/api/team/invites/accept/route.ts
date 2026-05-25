import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { handle, ok } from '@/lib/api';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';

const schema = z.object({
  token: z.string().min(20),
  // Only used when the invitee doesn't have an account yet
  name: z.string().optional(),
  password: z.string().min(8).optional(),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  const invite = await db.teamInvite.findUnique({
    where: { token: body.token },
    include: { organization: true },
  });
  if (!invite || invite.revokedAt || invite.acceptedAt) throw new NotFoundError('Invitation invalide ou déjà utilisée');
  if (invite.expiresAt < new Date()) throw new ValidationError('Invitation expirée');

  // Find or create user
  const session = await auth();
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;

  let userId: string;
  if (sessionUserId) {
    const sessionUser = await db.user.findUnique({ where: { id: sessionUserId } });
    if (sessionUser?.email !== invite.email) {
      throw new ValidationError(`Cette invitation est destinée à ${invite.email}. Tu es connecté comme ${sessionUser?.email}.`);
    }
    userId = sessionUserId;
  } else {
    const existing = await db.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      userId = existing.id;
    } else {
      if (!body.password || !body.name) {
        throw new ValidationError('Mot de passe et nom requis pour créer le compte');
      }
      const hash = await bcrypt.hash(body.password, 10);
      const u = await db.user.create({
        data: { email: invite.email, name: body.name, passwordHash: hash },
      });
      userId = u.id;
    }
  }

  await db.teamMember.upsert({
    where: { userId_organizationId: { userId, organizationId: invite.organizationId } },
    update: { role: invite.role },
    create: { userId, organizationId: invite.organizationId, role: invite.role },
  });

  await db.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

  return ok({ organizationId: invite.organizationId, organizationName: invite.organization.name });
});
