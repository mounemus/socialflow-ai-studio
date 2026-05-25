import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const members = await db.teamMember.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, email: true, name: true, image: true, disabled: true, createdAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return ok(members);
});
