import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500);
  const entries = await db.auditLog.findMany({
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return ok(entries);
});
