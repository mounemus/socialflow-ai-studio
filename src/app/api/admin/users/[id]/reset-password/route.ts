import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';

export const POST = handle(async (_req, { params }) => {
  const admin = await requireSuperAdmin();
  const { id } = await params;

  const newPassword = crypto.randomBytes(12).toString('base64url').slice(0, 12);
  const hash = await bcrypt.hash(newPassword, 10);
  await db.user.update({ where: { id }, data: { passwordHash: hash } });

  await db.auditLog.create({
    data: { userId: admin.id, action: 'admin.user.reset-password', resource: 'user', resourceId: id },
  });

  return ok({ newPassword });
});
