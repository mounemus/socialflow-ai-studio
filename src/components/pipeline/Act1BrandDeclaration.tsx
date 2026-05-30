'use client';

import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface Act1Seed {
  name?: string | null;
  industry?: string | null;
  description?: string | null;
  audienceHint?: string | null;
  website?: string | null;
}

export interface Act1BrandDeclarationProps {
  pipelineId: string;
  seed?: Act1Seed | null;
  horizon?: string | null;
  brandName?: string | null;
  // Permissive: PipelineRunner spreads a shared bag of helpers into every Act.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}

/**
 * Acte 1 — Déclaration de la marque
 *
 * Read-only display of the seed data captured at /pipelines/new.
 * Always shown as "done" since the brand row exists as soon as the
 * pipeline is created (CREATE_BRAND step runs synchronously).
 */
export function Act1BrandDeclaration(props: Act1BrandDeclarationProps) {
  const { pipelineId, seed: seedProp, horizon: horizonProp, brandName } = props;
  // When PipelineRunner spreads its `actProps` bag in, seed/horizon are absent
  // but a `run` is present — derive from there.
  const run = (props.run ?? null) as
    | {
        seed?: Record<string, unknown> | null;
        horizon?: string | null;
        brand?: { name?: string | null } | null;
      }
    | null;
  const seed: Act1Seed | null =
    (seedProp ?? (run?.seed as Act1Seed | undefined) ?? null) || null;
  const horizon = horizonProp ?? run?.horizon ?? null;
  const displayName = brandName ?? run?.brand?.name ?? seed?.name ?? '—';

  const rows: Array<{ label: string; value: string | null | undefined }> = [
    { label: 'Nom de marque', value: displayName },
    { label: 'Industrie', value: seed?.industry },
    { label: 'Description', value: seed?.description },
    { label: 'Audience cible', value: seed?.audienceHint },
    { label: 'Site web', value: seed?.website },
    { label: 'Horizon', value: horizon ?? null },
  ];

  return (
    <Card
      className="border-emerald-200 bg-emerald-50/30"
      data-act="1"
      data-pipeline-id={pipelineId}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-emerald-100 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-emerald-700">Acte 1 · DÉCLARATION</span>
          <Badge variant="success" className="text-[10px]">DONE</Badge>
        </CardTitle>
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="space-y-0.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {row.label}
              </dt>
              <dd className="text-sm text-slate-800">
                {row.value && row.value.trim().length > 0 ? (
                  row.value
                ) : (
                  <span className="italic text-slate-400">non renseigné</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default Act1BrandDeclaration;
