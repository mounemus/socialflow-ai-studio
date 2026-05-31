'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Segment error boundary for all dashboard pages.
 * Converts an unhandled client/render exception into a recoverable screen
 * (instead of Next.js's bare white "Application error") and surfaces the real
 * message + digest so the cause is visible.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the browser console for debugging.
    // eslint-disable-next-line no-console
    console.error('[dashboard error boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-rose-50/50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
          <AlertTriangle className="h-6 w-6 text-rose-600" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          Une erreur est survenue sur cette page
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Le reste de l&apos;application fonctionne. Tu peux réessayer ou revenir au tableau de bord.
        </p>
        {error?.message ? (
          <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border bg-white p-3 text-left text-xs text-rose-700">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset} variant="brand" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
          </Button>
          <Link href="/dashboard">
            <Button variant="outline" size="sm">
              <Home className="mr-2 h-4 w-4" /> Tableau de bord
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
