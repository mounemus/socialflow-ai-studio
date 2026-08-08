import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ZernioConnectService } from '@/services/gateway/ZernioConnectService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const schema = z.object({ brandId: z.string().optional() });

/**
 * POST /api/late/sync-accounts { brandId? } — synchronise les comptes connectés
 * côté Zernio vers les SocialAccount locaux (mapping metadata.lateAccountId).
 * `brandId` optionnel : affecte d'office la marque choisie aux comptes
 * rapatriés. À appeler après chaque connexion OAuth côté Zernio.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');
  const { brandId } = schema.parse(await req.json().catch(() => ({})));
  const result = await ZernioConnectService.syncAccounts(ctx.organizationId, brandId);
  return ok(result);
});
