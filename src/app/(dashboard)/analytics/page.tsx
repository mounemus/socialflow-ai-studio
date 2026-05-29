import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { AnalyticsService } from '@/services/analytics/AnalyticsService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const overview = await AnalyticsService.overview(membership.organizationId);
  const byPlatform = await AnalyticsService.byPlatform(membership.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytique</h1>
        <p className="text-sm text-muted-foreground">Indicateurs agrégés sur l'ensemble des marques et plateformes.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Publications totales</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{overview.counts.posts.toLocaleString('fr-FR')}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Impressions cumulées</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{overview.totals.impressions.toLocaleString('fr-FR')}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Engagement (J'aime+Comm+Partages)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {(overview.totals.likes + overview.totals.comments + overview.totals.shares).toLocaleString('fr-FR')}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Performance par plateforme</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(byPlatform).length === 0 ? (
            <p className="text-sm text-muted-foreground">Pas encore de données — publie pour voir les métriques.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(byPlatform).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between rounded border p-3 text-sm">
                  <span className="font-medium">{k}</span>
                  <span className="text-muted-foreground">{v.impressions.toLocaleString('fr-FR')} impressions · {v.engagement} engagements · {v.posts} posts</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
