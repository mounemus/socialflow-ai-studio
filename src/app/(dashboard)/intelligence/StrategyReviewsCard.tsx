'use client';

/** Sortie de la boucle apprenante : les revues hebdo de stratégie (cron du lundi). */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';

type Review = {
  strategyId: string;
  strategyTitle: string;
  brandName: string | null;
  review: {
    reviewedAt?: string;
    observations?: string[];
    whatWorks?: string[];
    whatStruggles?: string[];
    proposals?: Array<{ title?: string; rationale?: string; impact?: string; effort?: string }>;
    metrics?: { itemsExecuted?: number; totalImpressions?: number; totalEngagement?: number; avgScore?: number | null };
  };
};

export function StrategyReviewsCard() {
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    fetch('/api/intelligence/strategy-reviews', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setReviews(j.data?.reviews ?? []))
      .catch(() => setReviews([]));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <RefreshCw className="h-4 w-4 text-violet-600" /> Revues hebdomadaires de stratégie
        </CardTitle>
        <CardDescription className="text-xs">
          Chaque lundi, l&apos;agent relit la stratégie à la lumière des performances réelles et propose des ajustements.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reviews === null ? (
          <p className="text-xs text-muted-foreground">Chargement…</p>
        ) : reviews.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Aucune revue pour l&apos;instant — la première arrive lundi matin (ou dès qu&apos;une stratégie validée existe).
          </p>
        ) : (
          reviews.map((r) => (
            <div key={r.strategyId} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                <span>{r.strategyTitle}{r.brandName ? ` — ${r.brandName}` : ''}</span>
                {r.review.reviewedAt ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {new Date(r.review.reviewedAt).toLocaleDateString('fr-CA')}
                  </span>
                ) : null}
              </div>
              {r.review.whatWorks?.length ? (
                <p className="mt-1 text-xs"><span className="font-semibold text-emerald-700">Ça marche :</span> {r.review.whatWorks.join(' · ')}</p>
              ) : null}
              {r.review.whatStruggles?.length ? (
                <p className="mt-1 text-xs"><span className="font-semibold text-amber-700">Frictions :</span> {r.review.whatStruggles.join(' · ')}</p>
              ) : null}
              {r.review.proposals?.length ? (
                <ul className="mt-2 space-y-1">
                  {r.review.proposals.map((p, i) => (
                    <li key={i} className="rounded bg-slate-50 p-2 text-xs">
                      <span className="font-medium">{p.title}</span>
                      {p.impact ? <Badge variant="outline" className="ml-2 text-[10px]">impact {p.impact}</Badge> : null}
                      {p.effort ? <Badge variant="outline" className="ml-1 text-[10px]">effort {p.effort}</Badge> : null}
                      {p.rationale ? <div className="text-muted-foreground">{p.rationale}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
