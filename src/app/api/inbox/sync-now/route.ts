import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ZernioInboxService } from '@/services/inbox/ZernioInboxService';
import { GmailInboxService } from '@/services/integrations/GmailInboxService';
import { getLateTraces } from '@/services/gateway/adapters/late';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/inbox/sync-now — synchronisation Zernio + Gmail à la demande.
 *
 * Le cron passe toutes les 5 min ; ce bouton donne un retour immédiat ET
 * expose le détail (raisons de skip, traces HTTP) — indispensable pour
 * diagnostiquer les shapes non documentées de l'API Zernio, que Vercel
 * n'affiche pas dans ses logs (une seule ligne conservée par requête).
 *
 * Gmail est ingéré en best-effort : une boîte non connectée ne doit jamais
 * faire échouer la synchro Zernio.
 */
export const POST = handle(async () => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');

  const zernio = await ZernioInboxService.ingestForOrganization(ctx.organizationId);
  let emails = 0;
  let gmailSkipped = 0;
  let gmailReasons: Record<string, number> = {};
  try {
    const gmail = await GmailInboxService.ingestForOrganization(ctx.organizationId);
    emails = gmail.emails;
    gmailSkipped = gmail.skipped;
    gmailReasons = gmail.reasons;
  } catch (err) {
    logger.warn('sync-now: ingestion Gmail échouée', { err: (err as Error).message });
    gmailReasons = { 'gmail-exception': 1 };
  }

  const reasons = { ...zernio.reasons };
  for (const [k, v] of Object.entries(gmailReasons)) reasons[k] = (reasons[k] ?? 0) + v;

  return ok({
    comments: zernio.comments,
    dms: zernio.dms,
    emails,
    skipped: zernio.skipped + gmailSkipped,
    reasons,
    traces: getLateTraces(),
  });
});
