import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Workflow } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const items = await db.automation.findMany({
    where: { organizationId: membership.organizationId },
    include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { runs: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automatisations</h1>
        <p className="text-sm text-muted-foreground">Workflows déclencheurs → actions IA + publication.</p>
      </div>

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
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{a.name}</span>
                  <Badge variant={a.status === 'ACTIVE' ? 'success' : 'secondary'}>{a.status}</Badge>
                </CardTitle>
                <CardDescription>Trigger: {a.triggerType} · {a.steps.length} étape{a.steps.length > 1 ? 's' : ''} · {a._count.runs} run{a._count.runs > 1 ? 's' : ''}</CardDescription>
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
