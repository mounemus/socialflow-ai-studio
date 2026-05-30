import Link from 'next/link';
import { Wrench, FileText, Image as ImageIcon, BarChart3 } from 'lucide-react';
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
import { cn } from '@/lib/utils';

export interface ProductionPostRow {
  id: string;
  title: string;
  format: string;
  brandName: string | null;
  hasMedia: boolean;
  scoreOverall: number | null;
}

function Dot({ done, label, icon }: { done: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        done
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-slate-100 text-slate-500',
      )}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span>{done ? '✓' : '⏳'}</span>
    </span>
  );
}

export function ProductionInProgressPanel({
  posts,
}: {
  posts: ProductionPostRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-brand-600" />
            En production
          </CardTitle>
          <CardDescription>
            {posts.length > 0
              ? `${posts.length} post${posts.length > 1 ? 's' : ''} à finaliser`
              : 'Aucun post en production'}
          </CardDescription>
        </div>
        <Link href="/ai-studio">
          <Button variant="outline" size="sm">
            Studio IA
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-8 w-8" />}
            title="Tout est produit ✓"
            description="Aucun post n'attend de production."
          />
        ) : (
          <ul className="divide-y rounded-md border">
            {posts.map((p) => {
              const hasText = true; // Post existing implies text is in place
              const hasVisuals = p.hasMedia;
              const hasScore = p.scoreOverall !== null && p.scoreOverall !== undefined;
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {p.format}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {p.brandName ?? 'Sans marque'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <Dot
                        done={hasText}
                        label="Texte"
                        icon={<FileText className="h-3 w-3" />}
                      />
                      <Dot
                        done={hasVisuals}
                        label="Visuels"
                        icon={<ImageIcon className="h-3 w-3" />}
                      />
                      <Dot
                        done={hasScore}
                        label="Score"
                        icon={<BarChart3 className="h-3 w-3" />}
                      />
                    </div>
                  </div>
                  <Link href={`/ai-studio?postId=${p.id}`} className="shrink-0">
                    <Button variant="brand" size="sm">
                      Produire
                    </Button>
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
