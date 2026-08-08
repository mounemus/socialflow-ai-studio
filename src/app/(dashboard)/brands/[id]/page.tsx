import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight, Brain, Plus } from 'lucide-react';
import { BrandProfileForm } from './BrandProfileForm';

const PLATFORM_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', LINKEDIN: 'LinkedIn', TWITTER: 'X / Twitter',
  TIKTOK: 'TikTok', YOUTUBE: 'YouTube', PINTEREST: 'Pinterest',
};

export const dynamic = 'force-dynamic';

export default async function BrandDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  // Multi-org safe: derive org from brand, then check user is member or SUPER_ADMIN
  const brand = await db.brand.findUnique({
    where: { id },
    include: { profile: true, socialAccounts: true, competitors: true, trendWatches: true, organization: true },
  });
  if (!brand) notFound();

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({ where: { userId_organizationId: { userId, organizationId: brand.organizationId } } }),
  ]);
  if (!membership && user?.globalRole !== 'SUPER_ADMIN') notFound();

  const latestStrategy = await db.marketingStrategy.findFirst({
    where: { brandId: brand.id },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{brand.name}</h1>
          <p className="text-sm text-muted-foreground">
            {brand.industry ?? 'Pas d\'industrie'} · Organisation : <span className="font-medium">{brand.organization.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/brands/${brand.id}/workspace`}>
            <Button variant="brand" size="sm">
              Centre de travail <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
          <Badge variant="secondary">{brand.socialAccounts.length} compte{brand.socialAccounts.length > 1 ? 's' : ''}</Badge>
          <Badge variant="secondary">{brand.competitors.length} concurrent{brand.competitors.length > 1 ? 's' : ''}</Badge>
          <Badge variant="secondary">{brand.trendWatches.length} veille{brand.trendWatches.length > 1 ? 's' : ''}</Badge>
        </div>
      </div>

      {/* ===== INTELLIGENCE CTA ===== */}
      <Link href={`/intelligence?brandId=${brand.id}`}>
        <Card className="cursor-pointer border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 transition-shadow hover:shadow-md">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                <Brain className="h-5 w-5 text-emerald-700" />
              </div>
              <div>
                <div className="font-semibold text-sm">Production Intelligence</div>
                <div className="text-xs text-muted-foreground">Score qualité · ADN de marque · timing optimal · repurposing 1→N</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-emerald-600" />
          </CardContent>
        </Card>
      </Link>

      {/* ===== AI STRATEGY CTA ===== */}
      <Link href={`/brands/${brand.id}/strategy`}>
        <Card className="cursor-pointer border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 transition-shadow hover:shadow-md">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                <Sparkles className="h-5 w-5 text-violet-700" />
              </div>
              <div>
                <div className="font-semibold text-sm">
                  {latestStrategy ? `Stratégie marketing IA — ${latestStrategy.status}` : 'Générer une stratégie marketing complète'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {latestStrategy
                    ? `${latestStrategy._count.items} items · créée ${latestStrategy.createdAt.toLocaleDateString('fr-FR')} · ouvrir pour gérer`
                    : 'Claude analyse ta marque + concurrents + plateformes pour produire une stratégie ${horizon} actionnable + plan de publications concret'}
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-violet-600" />
          </CardContent>
        </Card>
      </Link>

      {/* ===== RÉSEAUX CONNECTÉS ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Réseaux connectés</CardTitle>
            <CardDescription>Les comptes sociaux rattachés à cette marque — utilisés pour publier.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Link href={`/social-accounts/connect?brandId=${brand.id}`}>
              <Button variant="brand" size="sm"><Plus className="mr-1 h-3 w-3" /> Connecter un réseau</Button>
            </Link>
            <Link href="/social-accounts">
              <Button variant="outline" size="sm">Gérer</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {brand.socialAccounts.length === 0 ? (
            <p className="py-3 text-sm italic text-muted-foreground">
              Aucun réseau rattaché. Cliquez « Connecter un réseau » — le compte sera automatiquement affecté à {brand.name}.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {brand.socialAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{PLATFORM_LABEL[a.platform] ?? a.platform}</span>
                    <span className="text-muted-foreground"> · @{String(a.handle ?? '').replace(/^@+/, '').replace(/^https?:\/\/\S*\//i, '')}</span>
                  </div>
                  <Badge variant={a.status === 'CONNECTED' ? 'success' : 'warning'} className="text-[10px]">
                    {a.status === 'CONNECTED' ? 'Connecté' : a.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand profile</CardTitle>
          <CardDescription>Plus tu remplis ce profil, meilleure sera la qualité de la stratégie IA.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandProfileForm brandId={brand.id} initial={brand.profile} logo={brand.logo} />
        </CardContent>
      </Card>
    </div>
  );
}
