'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Severity = 'green' | 'amber' | 'red';

interface ActionSuggestion {
  id?: string;
  severity: Severity;
  title: string;
  narrative: string;
  ctaLabel: string;
  ctaHref: string;
}

interface NextActionResponse {
  primary: ActionSuggestion | null;
  secondary?: ActionSuggestion[];
}

const SEVERITY_DOT: Record<Severity, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
};

const SEVERITY_RING: Record<Severity, string> = {
  green: 'ring-emerald-200',
  amber: 'ring-amber-200',
  red: 'ring-rose-200',
};

export function NextActionCard() {
  const [data, setData] = useState<NextActionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/next-action', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      // Tolerate {data: {...}} or {...}
      const body: NextActionResponse =
        payload?.data ?? payload ?? { primary: null, secondary: [] };
      setData(body);
    } catch (e) {
      setError((e as Error).message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // === Loading ===
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-slate-200" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-slate-200" />
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-4/6 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="mt-4 h-9 w-32 animate-pulse rounded bg-slate-200" />
        </CardContent>
      </Card>
    );
  }

  // === Error ===
  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Impossible de charger la prochaine action.
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  const primary = data?.primary ?? null;
  const secondary = data?.secondary ?? [];

  // === Empty (everything green) ===
  if (!primary) {
    return (
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500" />
            <div>
              <h3 className="text-lg font-semibold">Tu es à jour 🎯</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Explore les insights ou démarre un nouveau pipeline.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/intelligence">
              <Button variant="outline" size="sm">
                <Sparkles className="mr-1 h-3 w-3" />
                Voir les insights
              </Button>
            </Link>
            <Link href="/pipelines/new">
              <Button size="sm">Nouveau pipeline</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // === Primary action ===
  return (
    <div className="space-y-3">
      <Card
        className={cn(
          'ring-1 transition-shadow hover:shadow-md',
          SEVERITY_RING[primary.severity],
        )}
      >
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-block h-2.5 w-2.5 rounded-full ring-4 ring-offset-0',
                    SEVERITY_DOT[primary.severity],
                  )}
                />
                <h3 className="text-lg font-semibold leading-tight">
                  {primary.title}
                </h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {primary.narrative}
              </p>
            </div>
            <Link href={primary.ctaHref} className="shrink-0">
              <Button variant="brand">{primary.ctaLabel}</Button>
            </Link>
          </div>

          {secondary.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              {showMore ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Masquer
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Voir {secondary.length} autre{secondary.length > 1 ? 's' : ''} suggestion
                  {secondary.length > 1 ? 's' : ''}
                </>
              )}
            </button>
          ) : null}
        </CardContent>
      </Card>

      {showMore && secondary.length > 0
        ? secondary.slice(0, 2).map((s, i) => (
            <Card key={s.id ?? i} className="bg-slate-50/50">
              <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-block h-2 w-2 rounded-full',
                        SEVERITY_DOT[s.severity],
                      )}
                    />
                    <h4 className="text-sm font-semibold">{s.title}</h4>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.narrative}
                  </p>
                </div>
                <Link href={s.ctaHref}>
                  <Button variant="outline" size="sm">
                    {s.ctaLabel}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))
        : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Mise à jour…
        </div>
      ) : null}
    </div>
  );
}
