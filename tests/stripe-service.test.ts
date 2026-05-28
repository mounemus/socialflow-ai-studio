import { describe, it, expect } from 'vitest';
import { PLANS, StripeService } from '@/services/billing/StripeService';

describe('StripeService.PLANS', () => {
  it('has 4 plans defined', () => {
    expect(PLANS).toHaveLength(4);
    expect(PLANS.map((p) => p.id)).toEqual(['FREE', 'PRO', 'AGENCY', 'ENTERPRISE']);
  });

  it('limits are non-decreasing across plans (free < pro < agency)', () => {
    const free = StripeService.getPlan('FREE');
    const pro = StripeService.getPlan('PRO');
    const agency = StripeService.getPlan('AGENCY');
    expect(pro.limits.brands).toBeGreaterThan(free.limits.brands);
    expect(agency.limits.brands).toBeGreaterThanOrEqual(pro.limits.brands);
    expect(pro.limits.aiRequestsPerMonth).toBeGreaterThan(free.limits.aiRequestsPerMonth);
  });

  it('paid plans have a stripePriceEnv reference', () => {
    expect(StripeService.getPlan('PRO').stripePriceEnv).toBe('STRIPE_PRICE_PRO');
    expect(StripeService.getPlan('AGENCY').stripePriceEnv).toBe('STRIPE_PRICE_AGENCY');
  });

  it('free plan has no stripePriceEnv', () => {
    expect(StripeService.getPlan('FREE').stripePriceEnv).toBeUndefined();
  });

  it('isConfigured returns false when secret key absent', () => {
    // setup.ts doesn't set STRIPE_SECRET_KEY
    expect(StripeService.isConfigured()).toBe(false);
  });
});
