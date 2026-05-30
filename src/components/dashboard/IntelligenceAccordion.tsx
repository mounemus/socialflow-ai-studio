'use client';

import { useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Heart,
  MessageSquare,
  Share2,
  MousePointerClick,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  Loader2,
  Lightbulb,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatNumber } from '@/lib/utils';

export interface IntelligenceAccordionProps {
  kpis: {
    impressions: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
    engagementRate: number;
  };
  brandId?: string | null;
}

interface DailyBrief {
  configured?: boolean;
  message?: string;
  brand?: { id: string; name: string };
  dataPoints?: {
    trendItems: number;
    competitorPosts: number;
    recentPosts: number;
  };
  brief?: {
    summary: string;
    insights: string[];
    opportunities: string[];
    risks: string[];
    suggestedActions: {
      title: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
    }[];
  };
  generatedAt?: string;
}

const KPI_TILES = [
  { key: 'impressions', label: 'Impressions', icon: Eye, color: 'text-sky-600' },
  { key: 'likes', label: 'Likes', icon: Heart, color: 'text-rose-600' },
  { key: 'comments', label: 'Commentaires', icon: MessageSquare, color: 'text-violet-600' },
  { key: 'shares', label: 'Partages', icon: Share2, color: 'text-amber-600' },
  { key: 'clicks', label: 'Clics', icon: MousePointerClick, color: 'text-emerald-600' },
  { key: 'engagementRate', label: 'Engagement', icon: TrendingUp, color: 'text-brand-600' },
] as const;

export function IntelligenceAccordion({
  kpis,
  brandId,
}: IntelligenceAccordionProps) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const loadBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/daily-brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(brandId ? { brandId } : {}),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      const data: DailyBrief = payload?.data ?? payload;
      setBrief(data);
    } catch (e) {
      setError((e as Error).message || 'Erreur');
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [brandId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !fetched && !loading) {
      loadBrief();
    }
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-3" onClick={toggle}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" />
              Intelligence du jour
            </CardTitle>
            <CardDescription>
              KPIs 30j + brief IA (cliquer pour développer)
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" aria-label="Toggle">
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {open ? (
        <CardContent className="space-y-5">
          {/* KPIs grid 2x3 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KPI_TILES.map((tile) => {
              const Icon = tile.icon;
              const raw = kpis[tile.key as keyof typeof kpis] ?? 0;
              const formatted =
                tile.key === 'engagementRate'
                  ? `${(raw * 100).toFixed(1)}%`
                  : formatNumber(raw);
              return (
                <div
                  key={tile.key}
                  className="flex items-center gap-2 rounded-md border bg-slate-50/50 p-2.5"
                >
                  <Icon className={cn('h-4 w-4 shrink-0', tile.color)} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">
                      {formatted}
                    </div>
                    <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                      {tile.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Brief */}
          <div className="border-t pt-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Génération du brief IA…
              </div>
            ) : error ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <span className="flex items-center gap-2 text-amber-800">
                  <AlertTriangle className="h-4 w-4" />
                  Brief indisponible
                </span>
                <Button variant="outline" size="sm" onClick={loadBrief}>
                  Réessayer
                </Button>
              </div>
            ) : brief?.configured === false ? (
              <div className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground">
                {brief.message ?? 'Service IA non configuré.'}
              </div>
            ) : brief?.brief ? (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">{brief.brief.summary}</p>

                {brief.brief.insights?.length > 0 ? (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Lightbulb className="h-3 w-3" />
                      Insights
                    </div>
                    <ul className="ml-4 list-disc space-y-1 text-xs">
                      {brief.brief.insights.slice(0, 3).map((i, idx) => (
                        <li key={idx}>{i}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {brief.brief.suggestedActions?.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Actions suggérées
                    </div>
                    <div className="space-y-1.5">
                      {brief.brief.suggestedActions.slice(0, 3).map((a, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border bg-white p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium">{a.title}</div>
                            <Badge
                              variant={
                                a.priority === 'high'
                                  ? 'destructive'
                                  : a.priority === 'medium'
                                    ? 'warning'
                                    : 'secondary'
                              }
                              className="text-[9px]"
                            >
                              {a.priority}
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {a.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Aucun brief disponible pour le moment.
              </div>
            )}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
