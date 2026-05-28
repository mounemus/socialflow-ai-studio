import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { StripeService } from '@/services/billing/StripeService';

const schema = z.object({ plan: z.enum(['PRO', 'AGENCY', 'ENTERPRISE']) });

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.billing');
  const body = schema.parse(await req.json());

  if (!StripeService.isConfigured()) {
    return ok({ configured: false, message: 'Stripe non configuré. Pose STRIPE_SECRET_KEY via /admin/setup/stripe.' });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const session = await StripeService.createCheckoutSession(
    ctx.organizationId,
    body.plan,
    `${base}/billing?success=1`,
    `${base}/billing?canceled=1`,
  );
  return ok({ configured: true, url: session.url, id: session.id });
});
