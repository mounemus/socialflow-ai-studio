import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { StripeService } from '@/services/billing/StripeService';

export const POST = handle(async () => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.billing');

  if (!StripeService.isConfigured()) {
    return ok({ configured: false, message: 'Stripe non configuré.' });
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = await StripeService.createPortalSession(ctx.organizationId, `${base}/billing`);
  return ok({ configured: true, url });
});
