import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { VercelApiService } from '@/services/vercel/VercelApiService';
import { db } from '@/lib/db';

export const POST = handle(async () => {
  const admin = await requireSuperAdmin();
  const result = await VercelApiService.redeployFromGit();
  await db.auditLog.create({
    data: { userId: admin.id, action: 'vercel.redeploy', resource: 'deployment', resourceId: result.id },
  });
  return ok(result);
});
