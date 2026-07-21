import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText, Plus } from 'lucide-react';
import { BatchProduceButton } from '@/components/posts/BatchProduceButton';
import { ImportButton } from '@/components/import/ImportDialog';
import { PostsClient, type PostRow } from './PostsClient';

export const dynamic = 'force-dynamic';

export default async function PostsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const posts = await db.post.findMany({
    where: { organizationId: membership.organizationId },
    // `schedules` était chargé pour 100 posts sans jamais être lu.
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  const draftPostIds = posts.filter((p) => p.status === 'DRAFT').map((p) => p.id);

  // Serialize for the client component (Date → ISO string, narrow brand to name).
  const rows: PostRow[] = posts.map((p) => {
    const meta = (p.metadata as Record<string, unknown> | null) ?? {};
    const lastScore =
      (meta.lastScore as { overall?: number; verdict?: string } | undefined) ?? null;
    return {
      id: p.id,
      title: p.title,
      body: p.body,
      status: p.status,
      format: p.format,
      version: p.version,
      updatedAtISO: p.updatedAt.toISOString(),
      brandName: p.brand?.name ?? null,
      brandId: p.brandId ?? null,
      lastScore,
      originPipelineId:
        typeof meta.originPipelineId === 'string' ? meta.originPipelineId : null,
      originStrategyItemId:
        typeof meta.originStrategyItemId === 'string'
          ? meta.originStrategyItemId
          : null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publications</h1>
          <p className="text-sm text-muted-foreground">
            Toutes tes publications, tous formats, toutes marques.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BatchProduceButton draftPostIds={draftPostIds} />
          <ImportButton />
          <Link href="/ai-studio">
            <Button variant="brand">
              <Plus className="mr-2 h-4 w-4" /> Nouvelle via IA
            </Button>
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="Aucune publication"
          description="Crée ta première publication via le Studio IA."
          action={
            <Link href="/ai-studio">
              <Button variant="brand">Aller au Studio IA</Button>
            </Link>
          }
        />
      ) : (
        <PostsClient posts={rows} />
      )}
    </div>
  );
}
