import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FileText, Calendar, CheckCircle2, AlertCircle, TrendingUp, Sparkles } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;
  const orgId = membership.organizationId;

  const [overview, recentPosts, brandsCount, accountsCount] = await Promise.all([
    AnalyticsService.overview(orgId),
    db.post.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { brand: true },
    }),
    db.brand.count({ where: { organizationId: orgId } }),
    db.socialAccount.count({ where: { organizationId: orgId } }),
  ]);

  const tiles = [
    { icon: FileText, label: 'Publications créées', value: overview.counts.posts, color: 'text-sky-600' },
    { icon: Calendar, label: 'Programmées', value: overview.counts.scheduled, color: 'text-amber-600' },
    { icon: CheckCircle2, label: 'Publiées', value: overview.counts.published, color: 'text-emerald-600' },
    { icon: AlertCircle, label: 'Échouées', value: overview.counts.failed, color: 'text-rose-600' },
    { icon: TrendingUp, label: 'Impressions totales', value: overview.totals.impressions, color: 'text-violet-600' },
    { icon: Sparkles, label: 'Engagement', value: overview.totals.likes + overview.totals.comments + overview.totals.shares, color: 'text-fuchsia-600' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">
          {brandsCount} marque{brandsCount > 1 ? 's' : ''} · {accountsCount} compte{accountsCount > 1 ? 's' : ''} social{accountsCount > 1 ? 'aux' : ''} connectés
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{t.label}</CardTitle>
                <Icon className={`h-4 w-4 ${t.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{t.value.toLocaleString('fr-FR')}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Publications récentes</CardTitle>
            <CardDescription>Vue d'ensemble de l'activité éditoriale</CardDescription>
          </CardHeader>
          <CardContent>
            {recentPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune publication pour l'instant. Crée ta première via le Studio IA.</p>
            ) : (
              <ul className="divide-y">
                {recentPosts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium">{p.title ?? (p.body ?? '').slice(0, 60) ?? 'Sans titre'}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.brand?.name ?? '—'} · {p.format} · {p.status}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{p.updatedAt.toLocaleDateString('fr-FR')}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Démarrage rapide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <a href="/brands/new" className="block rounded-lg border p-3 hover:bg-slate-50">
              <div className="font-medium">1. Créer ta marque</div>
              <div className="text-xs text-muted-foreground">Brand profile, ton, charte, hashtags</div>
            </a>
            <a href="/social-accounts" className="block rounded-lg border p-3 hover:bg-slate-50">
              <div className="font-medium">2. Connecter tes comptes</div>
              <div className="text-xs text-muted-foreground">Facebook, Instagram, LinkedIn…</div>
            </a>
            <a href="/ai-studio" className="block rounded-lg border p-3 hover:bg-slate-50">
              <div className="font-medium">3. Générer du contenu IA</div>
              <div className="text-xs text-muted-foreground">Posts, calendriers, briefs Canva</div>
            </a>
            <a href="/calendar" className="block rounded-lg border p-3 hover:bg-slate-50">
              <div className="font-medium">4. Planifier et publier</div>
              <div className="text-xs text-muted-foreground">Calendrier éditorial unifié</div>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
