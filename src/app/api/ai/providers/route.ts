import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { ProviderCapabilityRegistry } from '@/services/ai/ProviderCapabilityRegistry';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * GET /api/ai/providers — registre des capacités fournisseurs IA :
 * disponibilité, modèles, tâches, coût estimé, latence/succès observés,
 * mode réel/simulé. Consommé par l'atelier créatif (choix de provider éclairé).
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const registry = await ProviderCapabilityRegistry.getRegistry(ctx.organizationId);
  return ok(registry);
});
