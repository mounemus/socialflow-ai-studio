'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Step = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
};

type Journey = {
  steps: Step[];
  doneCount: number;
  total: number;
  progress: number;
  next: Step | null;
};

/**
 * Le fil conducteur de la refonte « Orbit » : où en est la marque, et quelle
 * est LA prochaine action utile. Chaque étape est vérifiée en base via
 * /api/brand-journey — rien n'est simulé. Suit la marque active du contexte
 * global (le composant est re-rendu par router.refresh() au changement).
 */
export function BrandJourney() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/brand-journey')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.data ? setJourney(d.data) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  // En erreur, on ne montre rien plutôt qu'un faux parcours.
  if (failed) return null;

  if (!journey) {
    return (
      <div className="h-40 animate-pulse rounded-xl border bg-card" aria-hidden="true" />
    );
  }

  const { steps, doneCount, total, progress, next } = journey;

  return (
    <section className="rounded-xl border bg-card p-6 shadow-[0_3px_9px_rgba(39,41,33,0.03)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Votre parcours</div>
          <h2 className="mt-1 text-lg font-bold text-foreground">
            {next ? next.label : 'Votre marque tourne à plein régime'}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {next ? next.detail : 'Toutes les étapes sont en place — continuez à créer et à mesurer.'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xl font-extrabold leading-none text-foreground">{progress}%</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {doneCount}/{total} étapes
            </div>
          </div>
          {next ? (
            <Link href={next.href}>
              <Button size="sm" className="bg-brand-500 text-white hover:bg-brand-600">
                {next.cta}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      {/* Barre de progression */}
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${Math.max(progress, 3)}%` }}
        />
      </div>

      {/* Les 7 étapes — cliquables, l'étape suivante est mise en avant */}
      <ol className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {steps.map((s) => {
          const isNext = next?.id === s.id;
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                className={cn(
                  'flex h-full items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors',
                  s.done
                    ? 'border-transparent bg-secondary/60 text-muted-foreground hover:bg-secondary'
                    : isNext
                      ? 'border-brand-500/40 bg-brand-50 text-foreground hover:bg-brand-100'
                      : 'border-border bg-card text-muted-foreground hover:bg-secondary/50',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    s.done
                      ? 'border-transparent bg-[hsl(var(--success))] text-white'
                      : isNext
                        ? 'border-brand-500 text-brand-600'
                        : 'border-border',
                  )}
                >
                  {s.done ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn('block font-medium', s.done && 'line-through decoration-1')}>
                    {s.label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
