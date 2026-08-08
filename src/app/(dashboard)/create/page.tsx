'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wand2, Sparkles, PencilLine, ArrowRight, Workflow, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pipelineStatusMeta, pipelineStepLabel } from '@/lib/pipeline-status';

interface PipelineRow {
  id: string;
  status?: string;
  step?: string;
  brand?: { id: string; name: string } | null;
  updatedAt?: string;
}

/**
 * Point d'entrée unique de création — remplace les deux onglets séparés
 * « Stratégie » et « Studio ». Une seule question : « par où commencer ? »
 *   • Avec l'IA  → pipeline 5 Actes (marque → stratégie → contenus).
 *   • Manuel     → Studio (un contenu, de zéro).
 * Plus la reprise des stratégies déjà en cours, pour ne jamais repartir de rien.
 */
export default function CreatePage() {
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/pipelines', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows = (d?.data ?? []) as PipelineRow[];
        setPipelines(
          rows.filter((p) => p.status === 'RUNNING' || p.status === 'AWAITING_ADMIN' || p.status === 'PAUSED'),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Wand2 className="h-6 w-6 text-violet-600" /> Créer
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deux façons de produire : laissez l&apos;IA construire toute la stratégie, ou créez un
          contenu à la main.
        </p>
      </div>

      {/* Les deux modes */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Mode IA */}
        <Card className="flex flex-col border-violet-200 bg-violet-50/30">
          <CardContent className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              <h2 className="text-base font-semibold">Avec l&apos;IA — stratégie complète</h2>
            </div>
            <p className="flex-1 text-sm text-slate-600">
              L&apos;IA enrichit le profil de votre marque, génère une stratégie de contenus, produit
              les visuels et les textes — avec votre validation à chaque étape clé.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/brands/new" className="flex-1">
                <Button variant="brand" className="w-full">
                  Développer une marque <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/pipelines" className="flex-1">
                <Button variant="outline" className="w-full">
                  Mes stratégies
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Mode manuel */}
        <Card className="flex flex-col border-sky-200 bg-sky-50/30">
          <CardContent className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <PencilLine className="h-5 w-5 text-sky-600" />
              <h2 className="text-base font-semibold">Manuellement — un contenu</h2>
            </div>
            <p className="flex-1 text-sm text-slate-600">
              Un parcours court : choisissez la plateforme, écrivez (ou générez) le texte, ajoutez le
              visuel — le tout sur une seule publication, prête à publier.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/create/post" className="flex-1">
                <Button variant="brand" className="w-full">
                  Composer une publication <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/studio" className="flex-1">
                <Button variant="outline" className="w-full">
                  Atelier avancé
                </Button>
              </Link>
            </div>
            <Link href="/create/flow">
              <Button variant="ghost" size="sm" className="w-full text-xs">
                Éditeur nodal — enchaîner et rejouer une recette
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Reprendre */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Reprendre une stratégie en cours
        </h3>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : pipelines.length === 0 ? (
          <p className="text-sm italic text-slate-400">
            Aucune stratégie en cours. Lancez-en une avec l&apos;IA ci-dessus.
          </p>
        ) : (
          <div className="space-y-2">
            {pipelines.map((p) => (
              <Link key={p.id} href={`/pipelines/${p.id}`}>
                <Card className="transition-colors hover:border-violet-300 hover:bg-violet-50/40">
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-violet-500" />
                      <span className="text-sm font-medium">
                        {p.brand?.name ?? 'Pipeline'}
                      </span>
                      {p.step ? (
                        <span className="text-xs text-slate-400">· {pipelineStepLabel(p.step)}</span>
                      ) : null}
                    </div>
                    <Badge variant={pipelineStatusMeta(p.status).variant} className="text-[10px]">
                      {pipelineStatusMeta(p.status).label}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
