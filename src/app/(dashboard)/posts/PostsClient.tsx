'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Palette, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProducePostDialog } from '@/components/posts/ProducePostDialog';

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'
> = {
  DRAFT: 'secondary',
  IDEA: 'secondary',
  AI_GENERATED: 'info',
  IN_DESIGN: 'info',
  DESIGN_LINKED: 'info',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  SCHEDULED: 'info',
  QUEUED: 'info',
  PUBLISHING: 'info',
  UPLOADING: 'info',
  PROCESSING: 'info',
  PUBLISHED: 'success',
  SIMULATED: 'warning',
  FAILED: 'destructive',
  ACTION_REQUIRED: 'destructive',
  MANUAL_SHARE_REQUIRED: 'warning',
  ARCHIVED: 'secondary',
};

export interface PostRow {
  id: string;
  title: string | null;
  body: string | null;
  status: string;
  format: string;
  version: number;
  updatedAtISO: string; // serialized — client just displays it
  brandName: string | null;
  brandId: string | null;
  lastScore: { overall?: number; verdict?: string } | null;
  originPipelineId: string | null;
  originStrategyItemId: string | null;
}

export interface PostsClientProps {
  posts: PostRow[];
}

export function PostsClient({ posts }: PostsClientProps) {
  const router = useRouter();
  const [producing, setProducing] = useState<PostRow | null>(null);

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {posts.map((p) => {
              const isDraft = p.status === 'DRAFT';
              const displayTitle = p.title ?? (p.body ?? 'Sans titre').slice(0, 80);
              const dateLabel = new Date(p.updatedAtISO).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{displayTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.brandName ?? 'Sans marque'} · {p.format} · v{p.version} · {dateLabel}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.lastScore?.overall != null ? (
                      <Badge
                        variant={
                          p.lastScore.overall >= 70
                            ? 'success'
                            : p.lastScore.overall >= 50
                              ? 'warning'
                              : 'destructive'
                        }
                        className="text-[10px]"
                      >
                        Score {p.lastScore.overall}
                      </Badge>
                    ) : null}
                    <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>{p.status}</Badge>
                    {isDraft ? (
                      <Button
                        size="sm"
                        variant="brand"
                        onClick={() => setProducing(p)}
                        className="h-8"
                      >
                        <Palette className="mr-1 h-3 w-3" />
                        🎨 Produire
                      </Button>
                    ) : (
                      <Link href={`/studio?postId=${p.id}`}>
                        <Button size="sm" variant="outline" className="h-8">
                          <Eye className="mr-1 h-3 w-3" />
                          Voir
                        </Button>
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {producing ? (
        <ProducePostDialog
          open
          onClose={() => setProducing(null)}
          postId={producing.id}
          postTitle={producing.title ?? producing.body?.slice(0, 60) ?? null}
          format={producing.format}
          brandName={producing.brandName}
          brandId={producing.brandId}
          originPipelineId={producing.originPipelineId}
          originStrategyItemId={producing.originStrategyItemId}
          onProduced={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
