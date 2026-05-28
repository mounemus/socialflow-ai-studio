/**
 * StripeService — checkout sessions, customer portal, webhooks, plan management.
 *
 * Setup:
 *   1. Stripe Dashboard → Products → create 3 products (Pro, Agency, Enterprise) with monthly prices
 *   2. Copy price IDs into env: STRIPE_PRICE_PRO, STRIPE_PRICE_AGENCY, STRIPE_PRICE_ENTERPRISE
 *   3. Webhook endpoint: /api/billing/webhook → copy signing secret into STRIPE_WEBHOOK_SECRET
 *   4. Webhook events: checkout.session.completed, customer.subscription.{created,updated,deleted}
 *
 * All amounts in cents. EUR by default.
 */
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { ExternalApiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { OrgPlan } from '@prisma/client';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ExternalApiError('stripe', 'STRIPE_SECRET_KEY missing');
  _stripe = new Stripe(key); // SDK default api version
  return _stripe;
}

export interface PlanInfo {
  id: OrgPlan;
  label: string;
  priceCents: number;
  currency: string;
  features: string[];
  limits: {
    brands: number;
    socialAccounts: number;
    postsPerMonth: number;
    aiRequestsPerMonth: number;
    teamMembers: number;
  };
  stripePriceEnv?: string;
}

export const PLANS: PlanInfo[] = [
  {
    id: 'FREE',
    label: 'Free',
    priceCents: 0,
    currency: 'EUR',
    features: ['1 marque', '2 comptes sociaux', '20 posts/mois', '50 requêtes IA/mois', 'Publication mock'],
    limits: { brands: 1, socialAccounts: 2, postsPerMonth: 20, aiRequestsPerMonth: 50, teamMembers: 1 },
  },
  {
    id: 'PRO',
    label: 'Pro',
    priceCents: 2900,
    currency: 'EUR',
    features: ['5 marques', '15 comptes sociaux', '500 posts/mois', '5k requêtes IA/mois', 'Publication réelle', 'Veille marketing complète', '5 membres équipe'],
    limits: { brands: 5, socialAccounts: 15, postsPerMonth: 500, aiRequestsPerMonth: 5000, teamMembers: 5 },
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  {
    id: 'AGENCY',
    label: 'Agency',
    priceCents: 9900,
    currency: 'EUR',
    features: ['Marques illimitées', 'Comptes sociaux illimités', '5k posts/mois', '50k requêtes IA/mois', 'Espaces clients', 'Validation client', 'Analytics avancée', 'White-label', '20 membres'],
    limits: { brands: 9999, socialAccounts: 9999, postsPerMonth: 5000, aiRequestsPerMonth: 50000, teamMembers: 20 },
    stripePriceEnv: 'STRIPE_PRICE_AGENCY',
  },
  {
    id: 'ENTERPRISE',
    label: 'Enterprise',
    priceCents: 0, // contact sales
    currency: 'EUR',
    features: ['Sur devis', 'Multi-organisation', 'SSO/SAML', 'SLA dédié', 'Support prioritaire', 'Agent dev personnalisé'],
    limits: { brands: 99999, socialAccounts: 99999, postsPerMonth: 99999, aiRequestsPerMonth: 999999, teamMembers: 999 },
    stripePriceEnv: 'STRIPE_PRICE_ENTERPRISE',
  },
];

export const StripeService = {
  isConfigured(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  },

  getPlan(plan: OrgPlan): PlanInfo {
    const p = PLANS.find((x) => x.id === plan);
    if (!p) throw new Error(`Unknown plan: ${plan}`);
    return p;
  },

  /**
   * Get-or-create the Stripe Customer for an organization.
   */
  async ensureCustomer(organizationId: string): Promise<string> {
    const sub = await db.subscription.findUnique({ where: { organizationId } });
    if (sub?.stripeCustomerId) return sub.stripeCustomerId;

    const org = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { members: { include: { user: true }, where: { role: 'OWNER' }, take: 1 } },
    });
    const ownerEmail = org.members[0]?.user.email;

    const customer = await getStripe().customers.create({
      name: org.name,
      email: ownerEmail,
      metadata: { organizationId },
    });

    await db.subscription.upsert({
      where: { organizationId },
      update: { stripeCustomerId: customer.id },
      create: { organizationId, plan: 'FREE', stripeCustomerId: customer.id },
    });

    return customer.id;
  },

  /**
   * Create a Stripe Checkout session for upgrading to a paid plan.
   */
  async createCheckoutSession(organizationId: string, targetPlan: OrgPlan, successUrl: string, cancelUrl: string): Promise<{ url: string; id: string }> {
    const plan = this.getPlan(targetPlan);
    if (!plan.stripePriceEnv) throw new Error(`Plan ${targetPlan} not purchasable via checkout`);
    const priceId = process.env[plan.stripePriceEnv];
    if (!priceId) throw new ExternalApiError('stripe', `${plan.stripePriceEnv} not set`);

    const customerId = await this.ensureCustomer(organizationId);

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      subscription_data: { metadata: { organizationId, targetPlan } },
      metadata: { organizationId, targetPlan },
    });
    return { url: session.url!, id: session.id };
  },

  /**
   * Create a Stripe Customer Portal session for self-service cancel/upgrade.
   */
  async createPortalSession(organizationId: string, returnUrl: string): Promise<string> {
    const customerId = await this.ensureCustomer(organizationId);
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  },

  /**
   * Verify webhook signature and parse the event.
   */
  verifyWebhook(payload: string | Buffer, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new ExternalApiError('stripe', 'STRIPE_WEBHOOK_SECRET missing');
    return getStripe().webhooks.constructEvent(payload, signature, secret);
  },

  /**
   * Process a webhook event and sync our Subscription record.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organizationId;
        const targetPlan = session.metadata?.targetPlan as OrgPlan | undefined;
        if (!orgId || !targetPlan) return;
        const subscriptionId = session.subscription as string | null;
        await db.subscription.update({
          where: { organizationId: orgId },
          data: {
            plan: targetPlan,
            stripeSubscriptionId: subscriptionId,
          },
        });
        await db.organization.update({ where: { id: orgId }, data: { plan: targetPlan } });
        logger.info('Subscription created via checkout', { orgId, plan: targetPlan });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organizationId;
        if (!orgId) return;
        const priceId = sub.items.data[0]?.price.id;
        // Map price ID back to plan
        let plan: OrgPlan = 'FREE';
        if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'PRO';
        else if (priceId === process.env.STRIPE_PRICE_AGENCY) plan = 'AGENCY';
        else if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) plan = 'ENTERPRISE';

        const periodEnd = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
        await db.subscription.update({
          where: { organizationId: orgId },
          data: {
            plan,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
        });
        await db.organization.update({ where: { id: orgId }, data: { plan } });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organizationId;
        if (!orgId) return;
        await db.subscription.update({
          where: { organizationId: orgId },
          data: { plan: 'FREE', stripeSubscriptionId: null, cancelAtPeriodEnd: false },
        });
        await db.organization.update({ where: { id: orgId }, data: { plan: 'FREE' } });
        logger.info('Subscription canceled', { orgId });
        break;
      }
      default:
        // Ignore other event types — log for debugging
        logger.debug('Stripe webhook ignored', { type: event.type });
    }
  },

  /**
   * Check if an org can perform an action under its current plan.
   */
  async checkQuota(organizationId: string, action: 'createBrand' | 'createSocialAccount' | 'createPost' | 'useAi'): Promise<{ ok: boolean; limit?: number; current?: number }> {
    const org = await db.organization.findUnique({ where: { id: organizationId } });
    if (!org) return { ok: false };
    const plan = this.getPlan(org.plan);

    if (action === 'createBrand') {
      const current = await db.brand.count({ where: { organizationId } });
      return { ok: current < plan.limits.brands, limit: plan.limits.brands, current };
    }
    if (action === 'createSocialAccount') {
      const current = await db.socialAccount.count({ where: { organizationId } });
      return { ok: current < plan.limits.socialAccounts, limit: plan.limits.socialAccounts, current };
    }
    if (action === 'createPost') {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const current = await db.post.count({ where: { organizationId, createdAt: { gte: since } } });
      return { ok: current < plan.limits.postsPerMonth, limit: plan.limits.postsPerMonth, current };
    }
    if (action === 'useAi') {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const current = await db.aIRequest.count({ where: { organizationId, createdAt: { gte: since } } });
      return { ok: current < plan.limits.aiRequestsPerMonth, limit: plan.limits.aiRequestsPerMonth, current };
    }
    return { ok: true };
  },
};
