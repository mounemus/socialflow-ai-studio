import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { VercelApiService } from '@/services/vercel/VercelApiService';
import { db } from '@/lib/db';

export const DELETE = handle(async (_req, { params }) => {
  const admin = await requireSuperAdmin();
  const { id } = await params;
  await VercelApiService.deleteEnvVar(id);
  await db.auditLog.create({
    data: { userId: admin.id, action: 'env.delete', resource: 'vercel_env', resourceId: id },
  });
  return ok({ deleted: true });
});
