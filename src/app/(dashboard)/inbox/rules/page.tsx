import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { AutoReplyRulesClient, type RuleLite, type BrandLite } from './AutoReplyRulesClient';

export const dynamic = 'force-dynamic';

export default async function AutoReplyRulesPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;
  const orgId = membership.organizationId;

  const [rulesRaw, brandsRaw] = await Promise.all([
    db.autoReplyRule.findMany({
      where: { organizationId: orgId },
      include: { brand: { select: { id: true, name: true } } },
      orderBy: [{ brandId: 'asc' }, { createdAt: 'asc' }],
    }),
    db.brand.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const rules: RuleLite[] = rulesRaw.map((r) => ({
    id: r.id,
    brandId: r.brandId,
    brandName: r.brand?.name ?? null,
    enabled: r.enabled,
    allowedSentiments: r.allowedSentiments as RuleLite['allowedSentiments'],
    allowedTypes: r.allowedTypes as RuleLite['allowedTypes'],
    customPromptFragment: r.customPromptFragment,
    minSentimentScore: r.minSentimentScore,
    maxReplyLength: r.maxReplyLength,
    requireApproval: r.requireApproval,
    dailyCap: r.dailyCap,
  }));

  const brands: BrandLite[] = brandsRaw.map((b) => ({ id: b.id, name: b.name }));

  return <AutoReplyRulesClient initialRules={rules} brands={brands} />;
}
