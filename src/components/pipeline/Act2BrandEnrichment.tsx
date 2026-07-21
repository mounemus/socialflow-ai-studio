'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

export type Act2FieldStatus =
  | 'PENDING'
  | 'PROPOSED'
  | 'EDITED'
  | 'APPROVED'
  | 'REJECTED';

export interface Act2FieldState {
  status: Act2FieldStatus;
  value: unknown;
  rejectedReason?: string;
}

export interface Act2Run {
  step?: string;
  status?: string;
  fieldStates?: Record<string, Act2FieldState | unknown> | null;
}

export interface Act2BrandEnrichmentProps {
  pipelineId: string;
  run?: Act2Run | null;
  onChanged?: () => void;
  // Permissive: PipelineRunner spreads a shared bag of helpers into every Act.
  // Anything not listed above is silently ignored.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}

const FIELD_LABELS: Record<string, string> = {
  slogan: 'Slogan',
  mission: 'Mission',
  values: 'Valeurs',
  audienceTarget: 'Audience cible',
  toneOfVoice: 'Ton de voix',
  wordsToUse: 'Mots à utiliser',
  wordsToAvoid: 'Mots à éviter',
  officialHashtags: 'Hashtags officiels',
  primaryColor: 'Couleur principale',
  secondaryColor: 'Couleur secondaire',
  accentColor: "Couleur d'accent",
  visualStyle: 'Style visuel',
  brandDna: 'Brand DNA',
  palette: 'Palette',
};

const ARRAY_FIELDS = new Set(['wordsToUse', 'wordsToAvoid', 'officialHashtags']);
const COLOR_FIELDS = new Set(['primaryColor', 'secondaryColor', 'accentColor']);
const SHORT_FIELDS = new Set([
  'slogan',
  'toneOfVoice',
  'visualStyle',
  'primaryColor',
  'secondaryColor',
  'accentColor',
]);

function valueToString(field: string, value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringToValue(field: string, str: string): unknown {
  if (ARRAY_FIELDS.has(field)) {
    return str
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return str;
}

/**
 * Acte 2 — Enrichissement IA du Brand Profile.
 *
 * Renders one editable card per field. The pipeline drives state via:
 *   PATCH /api/pipelines/[id]/fields/[field]  -> edit
 *   POST  /api/pipelines/[id]/fields/[field]/approve
 *   POST  /api/pipelines/[id]/fields/[field]/enrich (regenerate)
 *
 * If `run` is missing or no field has even been PROPOSED yet, polls
 * /api/pipelines/[id] every 2s to watch for enrichment fan-out completion.
 */
export function Act2BrandEnrichment({
  pipelineId,
  run,
  onChanged,
}: Act2BrandEnrichmentProps) {
  const fieldStates = (run?.fieldStates ?? {}) as Record<string, Act2FieldState>;
  const fieldKeys = useMemo(
    () =>
      Object.keys(fieldStates).length > 0
        ? Object.keys(fieldStates)
        : Object.keys(FIELD_LABELS),
    [fieldStates],
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyField, setBusyField] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Seed drafts from current values. Une nouvelle valeur serveur (régénération,
  // enrichissement en masse) remplace le brouillon SAUF si l'utilisateur l'a
  // édité entre-temps (draft ≠ dernière valeur serveur connue).
  const [serverValues, setServerValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, string> = { ...prev };
      const nextServer: Record<string, string> = {};
      let serverChanged = false;
      for (const k of fieldKeys) {
        const sv = valueToString(k, fieldStates[k]?.value);
        nextServer[k] = sv;
        if (serverValues[k] !== sv) serverChanged = true;
        const userEdited = next[k] !== undefined && next[k] !== (serverValues[k] ?? '');
        if (next[k] === undefined || (!userEdited && sv !== next[k])) {
          next[k] = sv;
        }
      }
      if (serverChanged) setServerValues(nextServer);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKeys, fieldStates]);

  const hasAnyProposed = useMemo(
    () =>
      Object.values(fieldStates).some(
        (s) =>
          s &&
          (s.status === 'PROPOSED' ||
            s.status === 'EDITED' ||
            s.status === 'APPROVED'),
      ),
    [fieldStates],
  );

  // Pas de polling ici : PipelineRunner rafraîchit déjà `run` toutes les 5 s
  // (suspendu quand l'onglet est caché). Un intervalle de 2 s par acte tapait
  // le même endpoint lourd en parallèle du parent et saturait le pool DB.

  const summary = useMemo(() => {
    let approved = 0;
    let total = 0;
    for (const k of fieldKeys) {
      const s = fieldStates[k];
      if (!s) {
        total += 1;
        continue;
      }
      total += 1;
      if (s.status === 'APPROVED' || s.status === 'EDITED') approved += 1;
    }
    return { approved, total };
  }, [fieldKeys, fieldStates]);

  const allApproved =
    summary.total > 0 && summary.approved === summary.total;

  // Extrait un message d'erreur lisible — jamais une page HTML brute dans un toast.
  async function apiError(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    if (!text) return `Erreur ${res.status}`;
    if (text.trimStart().startsWith('<')) {
      return res.status === 404
        ? 'Endpoint introuvable (404) — recharge la page, une mise à jour est peut-être en cours.'
        : `Erreur serveur ${res.status}`;
    }
    try {
      const json = JSON.parse(text) as { message?: string; error?: string };
      return json.message ?? json.error ?? text.slice(0, 120);
    } catch {
      return text.slice(0, 120);
    }
  }

  const regenerate = useCallback(
    async (field: string) => {
      setBusyField(field);
      try {
        const res = await fetch(
          `/api/pipelines/${pipelineId}/fields/${encodeURIComponent(field)}/enrich`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(await apiError(res));
        // Injecter la NOUVELLE valeur dans le brouillon — sinon la zone de
        // texte garde l'ancienne proposition et "rien ne change" visuellement.
        const json = (await res.json().catch(() => null)) as
          | { data?: { value?: unknown; mocked?: boolean } }
          | null;
        if (json?.data && json.data.value !== undefined) {
          setDrafts((prev) => ({ ...prev, [field]: valueToString(field, json.data!.value) }));
        } else {
          // Pas de valeur dans la réponse : forcer le re-seed depuis le serveur.
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
          });
        }
        if (json?.data?.mocked) {
          toast.warning(
            `${FIELD_LABELS[field] ?? field} régénéré en SIMULATION — vérifie la config IA (ENABLE_REAL_AI + clés).`,
          );
        } else {
          toast.success(`${FIELD_LABELS[field] ?? field} régénéré`);
        }
        onChanged?.();
      } catch (err) {
        toast.error(`Régénération échouée: ${(err as Error).message.slice(0, 100)}`);
      } finally {
        setBusyField(null);
      }
    },
    [pipelineId, onChanged],
  );

  const saveEdit = useCallback(
    async (field: string) => {
      setBusyField(field);
      try {
        const value = stringToValue(field, drafts[field] ?? '');
        const res = await fetch(
          `/api/pipelines/${pipelineId}/fields/${encodeURIComponent(field)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value }),
          },
        );
        if (!res.ok) throw new Error(await apiError(res));
        toast.success(`${FIELD_LABELS[field] ?? field} enregistré`);
        onChanged?.();
      } catch (err) {
        toast.error(`Sauvegarde échouée: ${(err as Error).message.slice(0, 100)}`);
      } finally {
        setBusyField(null);
      }
    },
    [pipelineId, drafts, onChanged],
  );

  const approveField = useCallback(
    async (field: string) => {
      setBusyField(field);
      try {
        // Save edit first if the textarea diverges from current value.
        const cur = valueToString(field, fieldStates[field]?.value);
        if ((drafts[field] ?? '') !== cur) {
          await saveEdit(field);
        }
        const res = await fetch(
          `/api/pipelines/${pipelineId}/fields/${encodeURIComponent(field)}/approve`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(await apiError(res));
        toast.success(`${FIELD_LABELS[field] ?? field} validé ✓`);
        onChanged?.();
      } catch (err) {
        toast.error(`Validation échouée: ${(err as Error).message.slice(0, 100)}`);
      } finally {
        setBusyField(null);
      }
    },
    [pipelineId, drafts, fieldStates, saveEdit, onChanged],
  );

  const approveAll = useCallback(async () => {
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: 'VALIDATE_PROFILE' }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      toast.success('Acte 2 validé — passage à la stratégie…');
      onChanged?.();
    } catch (err) {
      toast.error(`Validation globale échouée: ${(err as Error).message.slice(0, 100)}`);
    } finally {
      setBulkBusy(false);
    }
  }, [pipelineId, onChanged]);

  // === HEADER ICON ===
  const headerIcon = allApproved ? (
    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
  ) : run?.status === 'AWAITING_ADMIN' ? (
    <Pencil className="h-5 w-5 text-amber-600" />
  ) : (
    <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
  );

  const headerBadge = allApproved ? (
    <Badge variant="success" className="text-[10px]">DONE</Badge>
  ) : run?.status === 'AWAITING_ADMIN' ? (
    <Badge variant="warning" className="text-[10px]">À VALIDER</Badge>
  ) : (
    <Badge variant="info" className="text-[10px]">RUNNING</Badge>
  );

  return (
    <Card
      className={
        allApproved
          ? 'border-emerald-200 bg-slate-50 opacity-80'
          : 'border-sky-200 bg-sky-50/20'
      }
      data-act="2"
      data-pipeline-id={pipelineId}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Acte 2 · ENRICHISSEMENT</span>
          {headerBadge}
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
            {summary.approved}/{summary.total} validés
          </span>
          {headerIcon}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        {!hasAnyProposed ? (
          <div className="space-y-3 py-6 text-center">
            <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500" />
            </div>
            <p className="text-sm text-slate-600">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              Enrichissement IA en cours…
            </p>
            <p className="text-xs text-slate-400">
              Génération des 11 champs (slogan, mission, ton, couleurs, hashtags…)
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {fieldKeys.map((field) => {
              const s = fieldStates[field];
              const status = s?.status ?? 'PENDING';
              const approved = status === 'APPROVED' || status === 'EDITED';
              const draft = drafts[field] ?? '';
              const isBusy = busyField === field;

              return (
                <div
                  key={field}
                  className={
                    'space-y-2 rounded-lg border bg-white p-3 ' +
                    (approved ? 'border-emerald-200' : 'border-slate-200')
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700">
                        {FIELD_LABELS[field] ?? field}
                      </span>
                      {approved ? (
                        <Badge variant="success" className="text-[9px]">
                          {status}
                        </Badge>
                      ) : status === 'PROPOSED' ? (
                        <Badge variant="info" className="text-[9px]">PROPOSÉ</Badge>
                      ) : status === 'REJECTED' ? (
                        <Badge variant="destructive" className="text-[9px]">REJETÉ</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">
                          {status}
                        </Badge>
                      )}
                    </div>
                    {approved ? (
                      <span title="Verrouillé après validation" className="text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                    ) : null}
                  </div>

                  {COLOR_FIELDS.has(field) ? (
                    <div className="flex items-center gap-2">
                      <span
                        className="h-8 w-8 rounded border"
                        style={{ background: draft || '#cccccc' }}
                      />
                      <Input
                        value={draft}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [field]: e.target.value }))
                        }
                        disabled={approved || isBusy}
                        placeholder="#RRGGBB"
                        className="font-mono text-xs"
                      />
                    </div>
                  ) : SHORT_FIELDS.has(field) ? (
                    <Input
                      value={draft}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [field]: e.target.value }))
                      }
                      disabled={approved || isBusy}
                      className="text-xs"
                    />
                  ) : (
                    <Textarea
                      value={draft}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [field]: e.target.value }))
                      }
                      disabled={approved || isBusy}
                      rows={ARRAY_FIELDS.has(field) ? 2 : 3}
                      className="text-xs"
                      placeholder={
                        ARRAY_FIELDS.has(field)
                          ? 'Séparer par virgules…'
                          : undefined
                      }
                    />
                  )}

                  {s?.rejectedReason ? (
                    <p className="text-[10px] italic text-red-600">
                      Rejeté: {s.rejectedReason}
                    </p>
                  ) : null}

                  {!approved ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        onClick={() => regenerate(field)}
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 h-3 w-3" />
                        )}
                        Régénérer
                      </Button>
                      <Button
                        size="sm"
                        variant="brand"
                        className="h-7 text-[10px]"
                        onClick={() => approveField(field)}
                        disabled={isBusy}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Approuver
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* === FOOTER === */}
      <div className="flex flex-col gap-2 border-t bg-white/60 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-slate-600">
          {allApproved
            ? 'Acte 2 validé ✓'
            : `${summary.approved}/${summary.total} champs validés`}
        </span>
        <div className="flex gap-2">
          {!allApproved ? (
            <Button
              variant="brand"
              size="sm"
              onClick={approveAll}
              disabled={bulkBusy || summary.approved < summary.total}
            >
              {bulkBusy ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              Tout approuver et continuer
            </Button>
          ) : null}
          {!hasAnyProposed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetch(`/api/pipelines/${pipelineId}/advance`, { method: 'POST' })
                  .then((r) => {
                    if (!r.ok) throw new Error('advance');
                    onChanged?.();
                  })
                  .catch(() => toast.error("Impossible d'avancer"));
              }}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> Forcer l'enrichissement
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default Act2BrandEnrichment;
