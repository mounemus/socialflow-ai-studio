import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CheckCircle2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const items = await db.approvalRequest.findMany({
    where: { organizationId: membership.organizationId },
    include: { post: { include: { brand: true } }, comments: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validations</h1>
        <p className="text-sm text-muted-foreground">Demandes d'approbation envoyées aux clients ou réviseurs.</p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-10 w-10" />} title="Aucune validation en attente" />
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <Card key={it.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{it.post.title ?? (it.post.body ?? '').slice(0, 60) ?? 'Sans titre'}</span>
                  <Badge variant={it.status === 'APPROVED' ? 'success' : it.status === 'REJECTED' ? 'destructive' : 'warning'}>{it.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>{it.post.brand?.name ?? 'Sans marque'} · {it.comments.length} commentaire{it.comments.length > 1 ? 's' : ''}</p>
                {it.message ? <p className="mt-2">"{it.message}"</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
