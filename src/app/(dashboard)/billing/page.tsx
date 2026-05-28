import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { PLANS, StripeService } from '@/services/billing/StripeService';
import { BillingClient } from './BillingClient';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({
    where: { userId },
    include: { organization: { include: { subscription: true } } },
  });
  if (!membership) return null;

  const org = membership.organization;
  const usage = await Promise.all([
    db.brand.count({ where: { organizationId: org.id } }),
    db.socialAccount.count({ where: { organizationId: org.id } }),
    db.post.count({ where: { organizationId: org.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    db.aIRequest.count({ where: { organizationId: org.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    db.teamMember.count({ where: { organizationId: org.id } }),
  ]);

  return (
    <BillingClient
      organization={{ id: org.id, name: org.name, plan: org.plan }}
      subscription={org.subscription ? {
        currentPeriodEnd: org.subscription.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
      } : null}
      usage={{
        brands: usage[0],
        socialAccounts: usage[1],
        postsThisMonth: usage[2],
        aiRequestsThisMonth: usage[3],
        teamMembers: usage[4],
      }}
      plans={PLANS}
      stripeConfigured={StripeService.isConfigured()}
      canManage={membership.role === 'OWNER' || membership.role === 'ADMIN'}
    />
  );
}
