import Link from 'next/link';
import { GitBranch, ArrowRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { pipelineStatusMeta, pipelineStepLabel } from '@/lib/pipeline-status';

export interface ActivePipelineRow {
  id: string;
  title: string;
  brandName: string | null;
  step: string;
  status: string;
  updatedAt: string;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris', // fixed TZ → identical server (UTC) & client render (no hydration mismatch)
    });
  } catch {
    return iso;
  }
}

export function ActivePipelinesPanel({
  pipelines,
}: {
  pipelines: ActivePipelineRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-brand-600" />
            Pipelines en cours
          </CardTitle>
          <CardDescription>
            {pipelines.length > 0
              ? `${pipelines.length} pipeline${pipelines.length > 1 ? 's' : ''} actif${pipelines.length > 1 ? 's' : ''}`
              : 'Aucun pipeline actif'}
          </CardDescription>
        </div>
        <Link href="/pipelines/new">
          <Button variant="outline" size="sm">
            Nouveau
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {pipelines.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="h-8 w-8" />}
            title="Aucun pipeline en cours"
            description="Démarre-en un pour générer une stratégie complète."
            action={
              <Link href="/pipelines/new">
                <Button variant="brand" size="sm">
                  Démarrer
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y rounded-md border">
            {pipelines.map((p) => {
              const meta = pipelineStatusMeta(p.status);
              return (
                <li key={p.id}>
                  <Link
                    href={`/pipelines/${p.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {p.title}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {p.brandName ?? 'Sans marque'} · {pipelineStepLabel(p.step)} ·{' '}
                        {/* Date formatée avec le fuseau du runtime : diffère
                            serveur (UTC) / client → hydration mismatch. React
                            recommande suppressHydrationWarning pour ce cas. */}
                        <span suppressHydrationWarning>{fmtDate(p.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={meta.variant} className="text-[10px]">
                        {meta.label}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
