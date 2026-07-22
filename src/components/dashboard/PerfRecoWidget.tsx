'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brain, TrendingUp, Clock, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PerfReco {
  hasData: boolean;
  window: { days: number; samples: number };
  byPlatform: { platform: string; posts: number; avgEngagementRate: number | null; impressions: number }[];
  bestHours: { hour: number; avgEngagementRate: number }[];
  topPosts: { postId: string; title: string | null; engagementRate: number | null; impressions: number }[];
  narrative: string | null;
  mocked: boolean;
}

/**
 * Widget Recommandations du Cockpit (Refonte Phase C) — les enseignements de
 * performance vivent à côté de ce qu'ils commentent, plus seulement sur une
 * page dédiée. Fondé sur les analytics RÉELS ; sans données, il le dit.
 */
export function PerfRecoWidget({ brandId }: { brandId?: string | null }) {
  const [reco, setReco] = useState<PerfReco | null | 'error'>(null);

  useEffect(() => {
    const params = new URLSearchParams({ days: '30' });
    if (brandId) params.set('brandId', brandId);
    fetch(`/api/intelligence/perf-recommendations?${params.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setReco(j.data ?? 'error'))
      .catch(() => setReco('error'));
  }, [brandId]);

  if (reco === null || reco === 'error') return null; // silencieux : le Cockpit n'affiche pas de widget cassé

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-600" /> Recommandations ({reco.window.days} j)
            {reco.mocked ? <Badge variant="warning" className="text-[9px]">narration simulée</Badge> : null}
          </span>
          <Link
            href="/intelligence"
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-slate-900"
          >
            Tout voir <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!reco.hasData ? (
          <p className="text-xs text-muted-foreground">
            Pas encore de données de performance réelles ({reco.window.samples} mesure) — publie et
            connecte tes comptes pour nourrir les recommandations. Aucun chiffre n’est inventé.
          </p>
        ) : (
          <>
            {reco.narrative ? (
              <p className="line-clamp-3 text-xs leading-relaxed text-slate-700">{reco.narrative}</p>
            ) : null}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {reco.byPlatform.slice(0, 3).map((p) => (
                <span key={p.platform} className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {p.platform} : {p.avgEngagementRate != null ? `${(p.avgEngagementRate * 100).toFixed(1)} %` : '—'}
                </span>
              ))}
              {reco.bestHours[0] ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> meilleure heure : {reco.bestHours[0].hour}h
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
