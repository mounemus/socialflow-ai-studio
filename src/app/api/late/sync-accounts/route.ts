import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ZernioConnectService } from '@/services/gateway/ZernioConnectService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/late/sync-accounts — synchronise les comptes connectés côté
 * Zernio vers les SocialAccount locaux (mapping metadata.lateAccountId).
 * À appeler après chaque connexion OAuth côté Zernio.
 */
export const POST = handle(async () => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');
  const result = await ZernioConnectService.syncAccounts(ctx.organizationId);
  return ok(result);
});
