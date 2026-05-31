'use client';

import { useEffect } from 'react';

/**
 * Global error boundary — catches errors in the ROOT layout (where the
 * segment error.tsx can't reach). Must render its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global error boundary]', error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f8fafc', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, width: '100%', textAlign: 'center', border: '1px solid #fecaca', background: '#fff', borderRadius: 16, padding: 32 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>Une erreur est survenue</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#64748b' }}>
              Recharge la page. Si le problème persiste, contacte le support.
            </p>
            {error?.message ? (
              <pre style={{ marginTop: 16, maxHeight: 128, overflow: 'auto', whiteSpace: 'pre-wrap', textAlign: 'left', background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, fontSize: 12 }}>
                {error.message}
                {error.digest ? `\n\ndigest: ${error.digest}` : ''}
              </pre>
            ) : null}
            <button
              onClick={reset}
              style={{ marginTop: 24, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
