import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { CapabilityService } from '@/services/capabilities/CapabilityService';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * GET /api/capabilities — real, per-org capability statuses.
 * Phase 0: the UI must read this instead of showing "prêt à connecter" /
 * fake "succès" labels.
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const capabilities = await CapabilityService.getForOrganization(ctx.organizationId);
  return ok({ capabilities, generatedAt: new Date().toISOString() });
});
