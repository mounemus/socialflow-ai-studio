import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { BrandWorkspaceService } from '@/services/dashboard/BrandWorkspaceService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Factory, Gauge, Share2, Sparkles, Target,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'info' | 'destructive' | 'secondary'> = {
  PUBLISHED: 'success',
  SIMULATED: 'warning',
  SCHEDULED: 'info',
  QUEUED: 'info',
  PUBLISHING: 'info',
  FAILED: 'destructive',
  ACTION_REQUIRED: 'destructive',
  MANUAL_SHARE_REQUIRED: 'warning',
  CONNECTED: 'success',
  TOKEN_EXPIRED: 'destructive',
  PERMISSION_MISSING: 'destructive',
  PENDING: 'secondary',
};

/**
 * Centre de travail par marque — une seule page pour piloter :
 * santé du Brand DNA, stratégie, prochaine action, décisions en attente,
 * 7 prochains jours, production, bloqués, comptes, performances, agent.
 */
export default async function BrandWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return null;

  const brandRow = await db.brand.findUnique({ where: { id }, select: { organizationId: true } });
  if (!brandRow) notFound();
  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: brandRow.organizationId } },
    }),
  ]);
  if (!membership && user?.globalRole !== 'SUPER_ADMIN') notFound();

  const ws = await BrandWorkspaceService.getWorkspace(brandRow.organizationId, id);

  return (
    <div className="space-y-6">
      {/* En-tête + prochaine action */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Centre de travail</div>
          <h1 className="text-2xl font-bold tracking-tight">{ws.brand.name}</h1>
          {ws.brand.industry ? (
            <p className="text-sm text-muted-foreground">{ws.brand.industry}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href={`/studio?brandId=${ws.brand.id}`}>
            <Button variant="brand" size="sm">
              <Sparkles className="mr-1 h-3 w-3" /> Créer du contenu
            </Button>
          </Link>
          <Link href={`/brands/${ws.brand.id}`}>
            <Button variant="outline" size="sm">Profil de marque <ArrowRight className="ml-1 h-3 w-3" /></Button>
          </Link>
        </div>
      </div>

      {ws.nextAction ? (
        <Card className="border-brand-600/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-brand-600" /> Prochaine action
            </CardTitle>
            <CardDescription>{ws.nextAction.narrative || ws.nextAction.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={ws.nextAction.ctaHref}>
              <Button variant="brand" size="sm">{ws.nextAction.ctaLabel}</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Brand DNA */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4" /> Brand DNA
            </CardTitle>
            <CardDescription>Complétude du profil : {ws.dna.completeness}%</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
              <div
                className={`h-full ${ws.dna.completeness >= 80 ? 'bg-emerald-500' : ws.dna.completeness >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${ws.dna.completeness}%` }}
              />
            </div>
            {ws.dna.missingFields.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Manquant : {ws.dna.missingFields.slice(0, 5).join(', ')}
                {ws.dna.missingFields.length > 5 ? '…' : ''}
              </p>
            ) : (
              <p className="text-xs text-emerald-600">Profil complet.</p>
            )}
            <Link href={`/brands/${ws.brand.id}`} className="text-xs text-brand-600 hover:underline">
              Compléter avec l’IA →
            </Link>
          </CardContent>
        </Card>

        {/* Stratégie active */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4" /> Stratégie active
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ws.activeStrategy ? (
              <>
                <div className="font-medium">{ws.activeStrategy.title}</div>
                <div className="text-xs text-muted-foreground">
                  {ws.activeStrategy.itemsCount} élément{ws.activeStrategy.itemsCount > 1 ? 's' : ''} ·{' '}
                  <Badge variant="success">{ws.activeStrategy.status}</Badge>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Aucune stratégie validée pour cette marque.
              </p>
            )}
            <Link href={`/brands/${ws.brand.id}/strategy`} className="text-xs text-brand-600 hover:underline">
              {ws.activeStrategy ? 'Ouvrir la stratégie →' : 'Générer une stratégie →'}
            </Link>
          </CardContent>
        </Card>

        {/* Décisions en attente */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" /> Décisions en attente
            </CardTitle>
            <CardDescription>{ws.pendingApprovals.length} validation(s) à traiter</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {ws.pendingApprovals.length === 0 ? (
              <p className="text-xs text-muted-foreground">Rien à valider. </p>
            ) : (
              ws.pendingApprovals.slice(0, 5).map((a) => (
                <Link key={a.id} href={`/approvals`} className="block truncate text-xs hover:underline">
                  • {a.post.title ?? a.post.format} <Badge variant="warning">{a.status}</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* 7 prochains jours */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> 7 prochains jours
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ws.upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucune publication planifiée. <Link href="/calendar" className="text-brand-600 hover:underline">Ouvrir le calendrier →</Link>
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {ws.upcoming.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      {new Date(s.scheduledFor).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' — '}
                      {s.post.title ?? s.post.format}
                      {s.socialAccount ? ` · ${s.socialAccount.platform}` : ' · partage manuel'}
                    </span>
                    <Badge variant={STATUS_BADGE[s.status] ?? 'secondary'}>{s.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Publications bloquées */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleAlert className="h-4 w-4 text-rose-600" /> Publications bloquées
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ws.blocked.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun blocage. </p>
            ) : (
              <ul className="space-y-1">
                {ws.blocked.map((b) => (
                  <li key={b.id} className="text-xs">
                    <Badge variant={STATUS_BADGE[b.status] ?? 'destructive'}>{b.status}</Badge>{' '}
                    {b.post.title ?? 'Sans titre'}
                    {b.errorMessage ? (
                      <span className="block truncate text-muted-foreground">{b.errorMessage}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Production en cours */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Factory className="h-4 w-4" /> En production
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ws.inProduction.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun contenu en cours.</p>
            ) : (
              <ul className="space-y-1">
                {ws.inProduction.map((p) => (
                  <li key={p.id} className="text-xs">
                    <Link href={`/posts/${p.id}`} className="hover:underline">
                      {p.title ?? p.format}
                    </Link>{' '}
                    <Badge variant="info">{p.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Comptes sociaux */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Share2 className="h-4 w-4" /> Comptes sociaux
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ws.socialAccounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucun compte. <Link href="/social-accounts/connect" className="text-brand-600 hover:underline">Connecter →</Link>
              </p>
            ) : (
              <ul className="space-y-1">
                {ws.socialAccounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-xs">
                    <span>{a.platform} · @{a.handle}</span>
                    <Badge variant={STATUS_BADGE[a.status] ?? 'secondary'}>{a.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Performances 30j */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4" /> Performances (30 j)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!ws.performance30d.hasData ? (
              <p className="text-xs text-muted-foreground">
                Pas encore de données analytics réelles pour cette marque — les métriques
                apparaîtront après les premières publications réelles.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold">{ws.performance30d.impressions.toLocaleString('fr-FR')}</div>
                  <div className="text-[10px] text-muted-foreground">Impressions</div>
                </div>
                <div>
                  <div className="text-lg font-bold">{ws.performance30d.reach.toLocaleString('fr-FR')}</div>
                  <div className="text-[10px] text-muted-foreground">Portée</div>
                </div>
                <div>
                  <div className="text-lg font-bold">{ws.performance30d.interactions.toLocaleString('fr-FR')}</div>
                  <div className="text-[10px] text-muted-foreground">Interactions</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agent */}
        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-brand-600" /> Activité de l’agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ws.agentRecommendations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucune activité. <Link href="/automations" className="text-brand-600 hover:underline">Créer un workflow avec l’agent →</Link>
              </p>
            ) : (
              <ul className="space-y-1">
                {ws.agentRecommendations.map((r) => (
                  <li key={r.id} className="text-xs">
                    {r.title ?? r.kind} ·{' '}
                    <span className="text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString('fr-FR')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
