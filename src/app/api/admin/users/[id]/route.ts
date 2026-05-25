import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

const schema = z.object({
  disabled: z.boolean().optional(),
  globalRole: z.enum(['SUPER_ADMIN', 'OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']).optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const admin = await requireSuperAdmin();
  const { id } = await params;
  const body = schema.parse(await req.json());

  if (id === admin.id && body.globalRole && body.globalRole !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Tu ne peux pas te rétrograder toi-même');
  }
  if (id === admin.id && body.disabled) {
    throw new ForbiddenError('Tu ne peux pas te désactiver toi-même');
  }

  const updated = await db.user.update({ where: { id }, data: body });
  return ok(updated);
});
