import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';

const patchSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']),
});

export const PATCH = handle(async (req, { params }) => {
  await requireSuperAdmin();
  const { memberId } = await params;
  const body = patchSchema.parse(await req.json());
  const m = await db.teamMember.update({ where: { id: memberId }, data: { role: body.role } });
  return ok(m);
});

export const DELETE = handle(async (_req, { params }) => {
  await requireSuperAdmin();
  const { memberId } = await params;
  await db.teamMember.delete({ where: { id: memberId } });
  return ok({ removed: true });
});
