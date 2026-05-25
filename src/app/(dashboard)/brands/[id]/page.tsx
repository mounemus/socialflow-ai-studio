import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BrandProfileForm } from './BrandProfileForm';

export const dynamic = 'force-dynamic';

export default async function BrandDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const brand = await db.brand.findFirst({
    where: { id, organizationId: membership.organizationId },
    include: { profile: true, socialAccounts: true, competitors: true, trendWatches: true },
  });
  if (!brand) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{brand.name}</h1>
          <p className="text-sm text-muted-foreground">{brand.industry ?? 'Pas d\'industrie'}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{brand.socialAccounts.length} compte{brand.socialAccounts.length > 1 ? 's' : ''}</Badge>
          <Badge variant="secondary">{brand.competitors.length} concurrent{brand.competitors.length > 1 ? 's' : ''}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Brand profile</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandProfileForm brandId={brand.id} initial={brand.profile} />
        </CardContent>
      </Card>
    </div>
  );
}
