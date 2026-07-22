import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Workflow, Plus, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { BrandPipelineStatus, BrandPipelineStep } from '@prisma/client';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<BrandPipelineStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  RUNNING: 'info',
  AWAITING_ADMIN: 'warning',
  PAUSED: 'secondary',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'secondary',
};

const STATUS_LABEL: Record<BrandPipelineStatus, string> = {
  RUNNING: 'En cours',
  AWAITING_ADMIN: 'En attente admin',
  PAUSED: 'En pause',
  COMPLETED: 'Terminé',
  FAILED: 'Échec',
  CANCELLED: 'Annulé',
};

const STEP_ORDER: BrandPipelineStep[] = [
  'CREATE_BRAND',
  'ENRICH_PROFILE',
  'VALIDATE_PROFILE',
  'GENERATE_STRATEGY',
  'VALIDATE_STRATEGY_ITEMS',
  'EXECUTE_ITEMS',
  'DONE',
];

const STEP_LABEL: Record<BrandPipelineStep, string> = {
  CREATE_BRAND: 'Création de la marque',
  ENRICH_PROFILE: 'Enrichissement IA du profil',
  VALIDATE_PROFILE: 'Validation du profil',
  GENERATE_STRATEGY: 'Génération de la stratégie',
  VALIDATE_STRATEGY_ITEMS: 'Validation des items',
  EXECUTE_ITEMS: 'Exécution / planification',
  DONE: 'Terminé',
};

function stepIndex(step: BrandPipelineStep): number {
  return STEP_ORDER.indexOf(step);
}

function StatusIcon({ status }: { status: BrandPipelineStatus }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'AWAITING_ADMIN') return <AlertCircle className="h-4 w-4 text-amber-600" />;
  if (status === 'FAILED' || status === 'CANCELLED') return <AlertCircle className="h-4 w-4 text-red-600" />;
  return <Loader2 className="h-4 w-4 animate-spin text-sky-600" />;
}

export default async function PipelinesPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  // ⚠️ Sélection explicite : les colonnes JSON `fieldStates`, `itemStates`,
  // `executionLog` et `trace` peuvent peser plusieurs Mo par run (visuels
  // hérités en base64). Les charger pour 100 lignes faisait tomber la fonction
  // serverless (OOM/timeout → page en erreur). Cette liste n'affiche que le
  // nom, le statut, l'étape et les dates : on ne lit rien d'autre.
  // Contexte de marque global : les pipelines suivent la marque active.
  const activeBrandId = await getActiveBrandId(membership.organizationId);
  const runs = await db.brandPipelineRun.findMany({
    where: {
      organizationId: membership.organizationId,
      ...(activeBrandId ? { brandId: activeBrandId } : {}),
    },
    select: {
      id: true,
      status: true,
      step: true,
      seed: true,
      createdAt: true,
      updatedAt: true,
      brand: { select: { id: true, name: true } },
      startedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  });

  const totalSteps = STEP_ORDER.length - 1; // exclude DONE from progress denominator

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipelines de production</h1>
          <p className="text-sm text-muted-foreground">
            Onboarding marques pilotés par IA : création, enrichissement, stratégie, validation, planification.
          </p>
        </div>
        <Link href="/pipelines/new">
          <Button variant="brand">
            <Plus className="mr-2 h-4 w-4" /> Nouveau pipeline
          </Button>
        </Link>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-10 w-10" />}
          title="Aucun pipeline"
          description="Lance ton premier pipeline d'onboarding marque : l'agent IA s'occupe de tout, avec validation admin aux moments-clés."
          action={
            <Link href="/pipelines/new">
              <Button variant="brand">
                <Plus className="mr-2 h-4 w-4" /> Démarrer un pipeline
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runs.map((run) => {
            const currentIdx = stepIndex(run.step);
            const stepNumber = run.step === 'DONE' ? totalSteps : Math.max(currentIdx, 0) + 1;
            const progressPct = Math.min(100, Math.round((stepNumber / totalSteps) * 100));
            // Le nom déclaré (seed) est connu dès l'Acte 1 — jamais de
            // "[création en cours]" quand on sait déjà pour quelle marque on travaille.
            const seed = run.seed as { name?: string } | null;
            const brandName = run.brand?.name ?? seed?.name ?? 'Marque en cours de création';
            const awaitingAdmin = run.status === 'AWAITING_ADMIN';

            return (
              <Link key={run.id} href={`/pipelines/${run.id}`} className="block">
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-semibold">{brandName}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Lancé par {run.startedBy?.name ?? run.startedBy?.email ?? 'inconnu'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={run.status} />
                        <Badge variant={STATUS_VARIANT[run.status]} className="text-[10px]">
                          {STATUS_LABEL[run.status]}
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{STEP_LABEL[run.step]}</span>
                        <span className="text-muted-foreground">
                          Étape {Math.min(stepNumber, totalSteps)} / {totalSteps}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={
                            run.status === 'FAILED' || run.status === 'CANCELLED'
                              ? 'h-full bg-red-500'
                              : run.status === 'COMPLETED'
                                ? 'h-full bg-emerald-500'
                                : 'h-full bg-sky-500'
                          }
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {awaitingAdmin ? (
                      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>Validation admin requise</span>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Créé le {run.createdAt.toLocaleDateString('fr-FR')}</span>
                      <span>Maj {run.updatedAt.toLocaleDateString('fr-FR')}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
