import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileBarChart, Plus, CalendarClock, Repeat } from 'lucide-react';
import {
  PERIOD_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  FREQUENCY_LABEL,
  type ReportPeriod,
  type ReportStatus,
  type ReportFrequency,
} from './_shared';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const [reports, schedules] = await Promise.all([
    db.report.findMany({
      where: { organizationId: membership.organizationId },
      include: { brand: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.reportSchedule.findMany({
      where: { organizationId: membership.organizationId },
      include: { brand: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rapports</h1>
          <p className="text-sm text-muted-foreground">
            Génère des rapports de performance en marque blanche, exportables en PDF, à la demande ou programmés.
          </p>
        </div>
        <Link href="/reports/new">
          <Button variant="brand">
            <Plus className="mr-2 h-4 w-4" /> Nouveau rapport
          </Button>
        </Link>
      </div>

      {/* ---- Reports ---- */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Rapports générés</h2>
        {reports.length === 0 ? (
          <EmptyState
            icon={<FileBarChart className="h-10 w-10" />}
            title="Aucun rapport"
            description="Crée ton premier rapport de performance : choisis une période, des sections, ta marque blanche, et l'IA s'occupe du reste."
            action={
              <Link href="/reports/new">
                <Button variant="brand">
                  <Plus className="mr-2 h-4 w-4" /> Créer un rapport
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((r) => {
              const status = r.status as ReportStatus;
              const period = r.period as ReportPeriod;
              return (
                <Link key={r.id} href={`/reports/${r.id}`} className="block">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <FileBarChart className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-semibold">{r.title}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {r.brand?.name ?? 'Toutes les marques'}
                          </div>
                        </div>
                        <Badge variant={STATUS_VARIANT[status]} className="text-[10px]">
                          {STATUS_LABEL[status]}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                          <CalendarClock className="h-3 w-3" />
                          {PERIOD_LABEL[period] ?? r.period}
                        </span>
                        <span>{r.sections.length} section{r.sections.length > 1 ? 's' : ''}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Créé le {r.createdAt.toLocaleDateString('fr-FR')}</span>
                        {r.generatedAt ? <span>Généré le {r.generatedAt.toLocaleDateString('fr-FR')}</span> : null}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Recurring schedules ---- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Rapports récurrents</h2>
        </div>
        {schedules.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Aucun rapport récurrent. Ouvre un rapport généré puis clique sur «&nbsp;Programmer ce rapport&nbsp;» pour
              automatiser sa génération et son envoi.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {schedules.map((s) => {
              const period = s.period as ReportPeriod;
              const frequency = s.frequency as ReportFrequency;
              return (
                <Card key={s.id} className="h-full">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-semibold">{s.title}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {s.brand?.name ?? 'Toutes les marques'}
                        </div>
                      </div>
                      <Badge variant={s.enabled ? 'success' : 'secondary'} className="text-[10px]">
                        {s.enabled ? 'Actif' : 'En pause'}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                        {FREQUENCY_LABEL[frequency]}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                        <CalendarClock className="h-3 w-3" />
                        {PERIOD_LABEL[period] ?? s.period}
                      </span>
                      {s.recipients.length > 0 ? (
                        <span>{s.recipients.length} destinataire{s.recipients.length > 1 ? 's' : ''}</span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      {s.nextRunAt ? (
                        <span>Prochain envoi&nbsp;: {s.nextRunAt.toLocaleDateString('fr-FR')}</span>
                      ) : (
                        <span>Pas encore planifié</span>
                      )}
                      {s.lastRunAt ? <span>Dernier&nbsp;: {s.lastRunAt.toLocaleDateString('fr-FR')}</span> : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
