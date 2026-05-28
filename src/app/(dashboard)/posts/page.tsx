import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  DRAFT: 'secondary',
  AI_GENERATED: 'info',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  SCHEDULED: 'info',
  PUBLISHED: 'success',
  FAILED: 'destructive',
};

export default async function PostsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const posts = await db.post.findMany({
    where: { organizationId: membership.organizationId },
    include: { brand: true, schedules: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publications</h1>
          <p className="text-sm text-muted-foreground">Toutes tes publications, tous formats, toutes marques.</p>
        </div>
        <Link href="/ai-studio">
          <Button variant="brand"><Plus className="mr-2 h-4 w-4" /> Nouvelle via IA</Button>
        </Link>
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="Aucune publication"
          description="Crée ta première publication via le Studio IA."
          action={<Link href="/ai-studio"><Button variant="brand">Aller au Studio IA</Button></Link>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {posts.map((p) => {
                const meta = (p.metadata as Record<string, unknown> | null) ?? {};
                const lastScore = meta.lastScore as { overall?: number; verdict?: string } | undefined;
                return (
                <li key={p.id} className="flex items-center justify-between p-4">
                  <div className="flex-1">
                    <div className="font-medium">{p.title ?? (p.body ?? 'Sans titre').slice(0, 80)}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.brand?.name ?? 'Sans marque'} · {p.format} · v{p.version} · {p.updatedAt.toLocaleDateString('fr-FR')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {lastScore?.overall != null ? (
                      <Badge variant={lastScore.overall >= 70 ? 'success' : lastScore.overall >= 50 ? 'warning' : 'destructive'} className="text-[10px]">
                        Score {lastScore.overall}
                      </Badge>
                    ) : null}
                    <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>{p.status}</Badge>
                  </div>
                </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
