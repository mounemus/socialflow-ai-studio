import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const orgs = await db.organization.findMany({
    select: { id: true, name: true, slug: true, plan: true },
    orderBy: { name: 'asc' },
  });
  return ok(orgs);
});
