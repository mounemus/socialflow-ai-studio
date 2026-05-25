import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const integrations = await db.userIntegration.findMany({
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return ok({
    integrations: integrations.map((i) => ({
      id: i.id,
      provider: i.provider,
      organization: i.organization,
      displayName: i.displayName,
      scope: i.scope,
      active: i.active,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      // never return the encrypted tokens
    })),
    canvaConfigured: !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET && process.env.ENABLE_CANVA_API === 'true',
  });
});
