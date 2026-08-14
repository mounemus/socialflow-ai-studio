import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { ProspectingService } from '@/services/prospecting/ProspectingService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prospects/providers — état LIVE des sources de prospection
 * (clés configurées). Interrogé par le client à chaque ouverture de la page :
 * l'état rendu côté serveur pouvait rester figé (app desktop, navigation SPA)
 * et afficher « clé absente » après qu'une clé venait d'être ajoutée.
 */
export const GET = handle(async () => {
  await requireTenant();
  return ok(ProspectingService.providers());
});
