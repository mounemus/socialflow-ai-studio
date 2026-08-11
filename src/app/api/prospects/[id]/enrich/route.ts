import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ProspectingService } from '@/services/prospecting/ProspectingService';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/prospects/[id]/enrich — enrichissement à la demande d'un prospect.
 * Gemini Search d'abord (gratuit), smartscraper ciblé (10 crédits) seulement
 * si l'email manque encore.
 */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');

  const result = await ProspectingService.enrich(id, ctx.organizationId);
  if (!result.ok) {
    return ok({ error: result.reason }, { status: 404 });
  }
  return ok(result);
});
