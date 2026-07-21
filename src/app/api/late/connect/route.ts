import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ZernioConnectService } from '@/services/gateway/ZernioConnectService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const schema = z.object({
  platform: z.enum(['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST']),
});

/**
 * POST /api/late/connect { platform } → { authUrl }
 * Crée (si besoin) le profil Zernio de l'organisation puis retourne l'URL
 * OAuth à ouvrir pour connecter le compte. Après autorisation, appeler
 * POST /api/late/sync-accounts pour rapatrier le mapping.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');
  const body = schema.parse(await req.json());
  const authUrl = await ZernioConnectService.getConnectUrl(ctx.organizationId, body.platform);
  return ok({ authUrl });
});
