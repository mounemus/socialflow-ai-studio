import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StrategyGeneratorClient } from './StrategyGeneratorClient';

export const dynamic = 'force-dynamic';

export default async function BrandStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const brand = await db.brand.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!brand) notFound();

  // Allow super admin OR member of brand's org
  const user = await db.user.findUnique({ where: { id: userId }, select: { globalRole: true } });
  const isMember = await db.teamMember.findUnique({
    where: { userId_organizationId: { userId: userId!, organizationId: brand.organizationId } },
  });
  if (!isMember && user?.globalRole !== 'SUPER_ADMIN') notFound();

  const strategies = await db.marketingStrategy.findMany({
    where: { brandId: brand.id },
    include: { items: { orderBy: { order: 'asc' } }, validatedBy: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/brands/${brand.id}`} className="text-xs text-slate-500 hover:underline">
          <ArrowLeft className="h-3 w-3 inline" /> Marque {brand.name}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-violet-600" />
          Stratégie marketing IA
        </h1>
        <p className="text-sm text-muted-foreground">
          Génère une stratégie complète + déclinaison concrète. Approuve item par item puis transforme en publications/campagnes réelles.
        </p>
      </div>

      <StrategyGeneratorClient
        brand={{ id: brand.id, name: brand.name, industry: brand.industry, hasProfile: !!brand.profile }}
        existingStrategies={strategies.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          horizon: s.horizon,
          generatedByModel: s.generatedByModel,
          createdAt: s.createdAt.toISOString(),
          validatedAt: s.validatedAt?.toISOString() ?? null,
          validatedBy: s.validatedBy?.email ?? null,
          items: s.items.map((i) => ({
            id: i.id,
            order: i.order,
            kind: i.kind,
            status: i.status,
            title: i.title,
            description: i.description,
            platform: i.platform,
            format: i.format,
            suggestedDate: i.suggestedDate?.toISOString() ?? null,
            hashtags: i.hashtags,
            cta: i.cta,
            postId: i.postId,
            campaignId: i.campaignId,
          })),
          strategy: s.strategy as Record<string, unknown>,
        }))}
      />
    </div>
  );
}
