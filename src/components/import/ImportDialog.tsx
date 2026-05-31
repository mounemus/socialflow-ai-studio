'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Upload,
  FileSpreadsheet,
  Rss,
  Loader2,
  X,
  FileUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandOption {
  id: string;
  name: string;
}

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the parent can refresh the list. */
  onImported?: () => void;
}

type Tab = 'csv' | 'rss';

// Target formats offered for RSS import — a focused subset of SupportFormat.
const RSS_FORMATS: Array<{ value: string; label: string }> = [
  { value: 'INSTAGRAM_POST', label: 'Instagram — Post' },
  { value: 'FACEBOOK_POST', label: 'Facebook — Post' },
  { value: 'LINKEDIN_POST', label: 'LinkedIn — Post' },
  { value: 'TWITTER_POST', label: 'X / Twitter — Post' },
  { value: 'NEWSLETTER', label: 'Newsletter' },
  { value: 'EMAIL_MARKETING', label: 'Email marketing' },
  { value: 'LANDING_COPY', label: 'Landing copy' },
];

// Minimal client-side CSV row counter — just to preview "N lignes détectées".
// The authoritative parse happens server-side.
function countCsvRows(text: string): number {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;
  // Assume the first non-empty line is a header.
  return Math.max(0, lines.length - 1);
}

export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const [tab, setTab] = useState<Tab>('csv');
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // CSV state
  const [csvText, setCsvText] = useState('');
  const [csvBrandId, setCsvBrandId] = useState('');

  // RSS state
  const [feedUrl, setFeedUrl] = useState('');
  const [rssBrandId, setRssBrandId] = useState('');
  const [limit, setLimit] = useState(10);
  const [asFormat, setAsFormat] = useState('INSTAGRAM_POST');

  const csvRowCount = useMemo(() => countCsvRows(csvText), [csvText]);

  // === Load brands once on open ===
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    fetch('/api/brands')
      .then((r) => r.json())
      .then(({ data }) => {
        if (cancel || !Array.isArray(data)) return;
        setBrands(data.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
      })
      .catch(() => {
        /* non-fatal — brand selector just stays empty (= toutes marques) */
      });
    return () => {
      cancel = true;
    };
  }, [open]);

  // === Reset on close ===
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setCsvText('');
      setFeedUrl('');
      setCsvBrandId('');
      setRssBrandId('');
      setLimit(10);
      setAsFormat('INSTAGRAM_POST');
      setTab('csv');
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  // === Close on Escape ===
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
    };
    reader.onerror = () => toast.error('Lecture du fichier impossible');
    reader.readAsText(file);
  }, []);

  const importCsv = useCallback(async () => {
    if (!csvText.trim()) {
      toast.error('Colle ou importe un CSV d\'abord');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: csvBrandId || undefined,
          csvText,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.message ?? 'Import CSV échoué');
        return;
      }
      const created: number = json?.data?.created ?? 0;
      const skipped: number = json?.data?.skipped ?? 0;
      toast.success(`${created} brouillon${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}`, {
        description: skipped > 0 ? `${skipped} ligne(s) ignorée(s)` : undefined,
      });
      onImported?.();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [csvText, csvBrandId, onImported, onClose]);

  const importRss = useCallback(async () => {
    if (!feedUrl.trim()) {
      toast.error('Renseigne l\'URL du flux RSS');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/import/rss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: rssBrandId || undefined,
          feedUrl,
          limit,
          asFormat,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.message ?? 'Import RSS échoué');
        return;
      }
      const created: number = json?.data?.created ?? 0;
      toast.success(`${created} brouillon${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}`);
      onImported?.();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [feedUrl, rssBrandId, limit, asFormat, onImported, onClose]);

  if (!open) return null;

  const brandSelect = (value: string, onChange: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <option value="">Toutes les marques (aucune)</option>
      {brands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <Card className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col bg-white shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-fuchsia-600" />
            <CardTitle className="text-lg">Importer du contenu</CardTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b px-4 pt-3">
          <button
            type="button"
            onClick={() => setTab('csv')}
            className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === 'csv'
                ? 'border-fuchsia-600 text-fuchsia-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" /> CSV
          </button>
          <button
            type="button"
            onClick={() => setTab('rss')}
            className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === 'rss'
                ? 'border-fuchsia-600 text-fuchsia-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Rss className="h-4 w-4" /> RSS
          </button>
        </div>

        <CardContent className="space-y-4 overflow-y-auto p-4">
          {tab === 'csv' ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-slate-500">Marque</Label>
                {brandSelect(csvBrandId, setCsvBrandId)}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-slate-500">
                    CSV (colle ou importe)
                  </Label>
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-fuchsia-700 hover:underline">
                    <FileUp className="h-3.5 w-3.5" /> Importer un fichier
                    <input
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => onFile(e.target.files?.[0])}
                    />
                  </label>
                </div>
                <Textarea
                  rows={8}
                  className="font-mono text-xs"
                  placeholder="title,body,platform,format,hashtags,scheduledDate,cta"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Colonnes reconnues : <code>title, body, platform, format, hashtags, scheduledDate, cta</code>.
                  Format déduit de la plateforme s&apos;il est absent.
                </p>
              </div>

              {csvText.trim() ? (
                <div className="rounded-md border border-dashed bg-slate-50 p-2 text-center text-xs text-slate-600">
                  {csvRowCount} ligne{csvRowCount > 1 ? 's' : ''} détectée{csvRowCount > 1 ? 's' : ''}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-slate-500">URL du flux</Label>
                <Input
                  type="url"
                  placeholder="https://exemple.com/feed.xml"
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-slate-500">Marque</Label>
                {brandSelect(rssBrandId, setRssBrandId)}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-slate-500">Nombre d&apos;items</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-slate-500">Format cible</Label>
                  <select
                    value={asFormat}
                    onChange={(e) => setAsFormat(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {RSS_FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Les {limit} derniers articles deviennent des brouillons (titre → titre, description → corps).
              </p>
            </>
          )}
        </CardContent>

        <div className="flex items-center justify-end gap-2 border-t bg-slate-50 p-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            variant="brand"
            size="sm"
            onClick={tab === 'csv' ? importCsv : importRss}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3 w-3" />
            )}
            Importer
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Self-contained header button: opens the ImportDialog and refreshes the route
 * after a successful import. Drop it into a server-component header (e.g. the
 * Posts page) next to "Nouvelle via IA".
 */
export function ImportButton({ onImported }: { onImported?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" /> Importer
      </Button>
      <ImportDialog
        open={open}
        onClose={() => setOpen(false)}
        onImported={() => {
          onImported?.();
          router.refresh();
        }}
      />
    </>
  );
}
