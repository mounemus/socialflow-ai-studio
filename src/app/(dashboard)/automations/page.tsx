import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Workflow } from 'lucide-react';
import { AIWorkflowPlanner } from './AIWorkflowPlanner';
import { AutomationControls } from './AutomationControls';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const items = await db.automation.findMany({
    where: { organizationId: membership.organizationId },
    include: {
      steps: { orderBy: { order: 'asc' } },
      runs: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { runs: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automatisations</h1>
        <p className="text-sm text-muted-foreground">Workflows déclencheurs → actions IA + publication.</p>
      </div>

      <AIWorkflowPlanner />

      {items.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-10 w-10" />}
          title="Aucune automatisation"
          description="Crée des workflows : tendance détectée → idée → génération → brief Canva → validation → planification."
        />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    {a.name}
                    <Badge variant={a.status === 'ACTIVE' ? 'success' : 'secondary'}>{a.status}</Badge>
                  </span>
                  <AutomationControls id={a.id} name={a.name} status={a.status} />
                </CardTitle>
                <CardDescription>
                  Trigger: {a.triggerType} · {a.steps.length} étape{a.steps.length > 1 ? 's' : ''} · {a._count.runs} run{a._count.runs > 1 ? 's' : ''}
                  {a.runs[0] ? (
                    <> · dernier run : {a.runs[0].status}{a.runs[0].createdAt ? ` (${a.runs[0].createdAt.toLocaleDateString('fr-CA')})` : ''}</>
                  ) : ' · jamais exécutée'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="text-sm text-muted-foreground">
                  {a.steps.map((s) => <li key={s.id}>→ {s.actionType}</li>)}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
