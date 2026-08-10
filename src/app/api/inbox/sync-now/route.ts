import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ZernioInboxService } from '@/services/inbox/ZernioInboxService';
import { getLateTraces } from '@/services/gateway/adapters/late';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/inbox/sync-now — synchronisation Zernio à la demande.
 *
 * Le cron passe toutes les 5 min ; ce bouton donne un retour immédiat ET
 * expose le détail (raisons de skip, traces HTTP) — indispensable pour
 * diagnostiquer les shapes non documentées de l'API Zernio, que Vercel
 * n'affiche pas dans ses logs (une seule ligne conservée par requête).
 */
export const POST = handle(async () => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');

  const summary = await ZernioInboxService.ingestForOrganization(ctx.organizationId);
  return ok({ ...summary, traces: getLateTraces() });
});
