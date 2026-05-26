'use client';
import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Tiny inline button that calls an enrich endpoint and applies the result to a single form field.
 *
 * Usage:
 *   <AIEnrichButton
 *     endpoint="/api/ai/enrich/brand-profile"
 *     payload={{ brandId, fields: ['slogan'], current: form }}
 *     field="slogan"
 *     onResult={(v) => setForm({ ...form, slogan: v })}
 *   />
 */
export function AIEnrichButton({
  endpoint,
  payload,
  field,
  onResult,
  className,
  size = 'sm',
}: {
  endpoint: string;
  payload: Record<string, unknown>;
  field: string;
  onResult: (value: unknown) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? 'Erreur IA');
      return;
    }
    const { data } = await res.json();
    const suggestion = data.suggestions?.[field];
    if (suggestion === undefined || suggestion === null) {
      toast.warning(`Pas de suggestion pour ${field}`);
      return;
    }
    onResult(suggestion);
    toast.success(data.mocked ? `Suggestion mock pour ${field}` : `${field} enrichi par IA`);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={loading}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50',
        size === 'md' && 'px-3 py-1 text-xs',
        className,
      )}
      title={`Enrichir ${field} avec l'IA`}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      IA
    </button>
  );
}

/**
 * Master button: enrich ALL empty fields in one call.
 */
export function AIEnrichAllButton({
  endpoint,
  buildPayload,
  emptyFields,
  onResults,
  className,
}: {
  endpoint: string;
  buildPayload: (fields: string[]) => Record<string, unknown>;
  emptyFields: string[];
  onResults: (suggestions: Record<string, unknown>) => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function run() {
    if (emptyFields.length === 0) {
      toast.info('Tous les champs sont déjà remplis');
      return;
    }
    setLoading(true);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPayload(emptyFields)),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? 'Erreur IA');
      return;
    }
    const { data } = await res.json();
    onResults(data.suggestions ?? {});
    toast.success(`${emptyFields.length} champs enrichis ${data.mocked ? '(mock)' : ''}`);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={loading || emptyFields.length === 0}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-shadow hover:shadow-md disabled:opacity-50',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? 'Génération…' : `Tout remplir avec l'IA${emptyFields.length > 0 ? ` (${emptyFields.length})` : ''}`}
    </button>
  );
}
