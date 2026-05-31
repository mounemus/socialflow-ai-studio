'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileBarChart, ChevronLeft, ChevronRight, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  SECTION_DEFS,
  ALL_SECTION_KEYS,
  PERIOD_LABEL,
  DEFAULT_WHITE_LABEL,
  type ReportPeriod,
  type ReportSectionKey,
  type WhiteLabel,
} from '../_shared';

type BrandOption = { id: string; name: string; logo: string | null };

const PERIOD_OPTIONS: ReportPeriod[] = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'LAST_MONTH',
  'LAST_QUARTER',
  'CUSTOM',
];

const STEPS = ['Période & portée', 'Sections', 'Marque blanche'] as const;

export function ReportWizardClient({ brands }: { brands: BrandOption[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Step 1
  const [title, setTitle] = useState('');
  const [brandId, setBrandId] = useState<string>(''); // '' = all brands
  const [period, setPeriod] = useState<ReportPeriod>('LAST_30_DAYS');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  // Step 2
  const [sections, setSections] = useState<Record<ReportSectionKey, boolean>>(
    () => Object.fromEntries(ALL_SECTION_KEYS.map((k) => [k, true])) as Record<ReportSectionKey, boolean>,
  );

  // Step 3
  const [wl, setWl] = useState<WhiteLabel>({ ...DEFAULT_WHITE_LABEL });

  function toggleSection(key: ReportSectionKey) {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  }

  function validateStep(target: number): boolean {
    if (target > 0 && !title.trim()) {
      toast.error('Le titre du rapport est requis');
      setStep(0);
      return false;
    }
    if (target > 0 && period === 'CUSTOM' && (!periodStart || !periodEnd)) {
      toast.error('Choisis une date de début et de fin pour la période personnalisée');
      setStep(0);
      return false;
    }
    return true;
  }

  function next() {
    if (!validateStep(step + 1)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function prev() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onGenerate() {
    const enabledSections = ALL_SECTION_KEYS.filter((k) => sections[k]);
    if (!validateStep(STEPS.length)) return;
    if (enabledSections.length === 0) {
      toast.error('Sélectionne au moins une section');
      setStep(1);
      return;
    }

    setSubmitting(true);
    try {
      setProgress('Création du rapport…');
      const createRes = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          ...(brandId ? { brandId } : {}),
          period,
          ...(period === 'CUSTOM' && periodStart
            ? { periodStart: new Date(periodStart).toISOString() }
            : {}),
          ...(period === 'CUSTOM' && periodEnd
            ? { periodEnd: new Date(periodEnd).toISOString() }
            : {}),
          sections: enabledSections,
          whiteLabel: wl,
        }),
      });
      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}));
        throw new Error(j.message ?? `Création impossible (HTTP ${createRes.status})`);
      }
      const created = await createRes.json();
      const reportId: string | undefined = created?.data?.id ?? created?.id;
      if (!reportId) throw new Error('Réponse inattendue du serveur (id manquant)');

      setProgress('Génération du rapport par l’IA…');
      const genRes = await fetch(`/api/reports/${reportId}/generate`, { method: 'POST' });
      if (!genRes.ok) {
        const j = await genRes.json().catch(() => ({}));
        throw new Error(j.message ?? `Génération impossible (HTTP ${genRes.status})`);
      }

      setProgress('Rapport prêt, redirection…');
      toast.success('Rapport généré');
      router.push(`/reports/${reportId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Une erreur est survenue');
      setSubmitting(false);
      setProgress(null);
    }
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <FileBarChart className="h-6 w-6" /> Nouveau rapport
        </h1>
        <p className="text-sm text-muted-foreground">
          Génère un rapport de performance en marque blanche en 3 étapes.
        </p>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ' +
                  (active
                    ? 'bg-brand-600 text-white'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground')
                }
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </button>
              <span className={'text-xs ' + (active ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
              {i < STEPS.length - 1 ? <div className="h-px flex-1 bg-border" /> : null}
            </li>
          );
        })}
      </ol>

      {/* Step 1 — Période & portée */}
      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Période & portée</CardTitle>
            <CardDescription>Définis le titre, la marque concernée et la période couverte.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Titre du rapport *</Label>
              <Input
                id="title"
                placeholder="Rapport de performance — Mai 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand">Marque</Label>
              <select
                id="brand"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
              >
                <option value="">Toutes les marques</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Période</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PERIOD_OPTIONS.map((p) => (
                  <label
                    key={p}
                    className={
                      'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ' +
                      (period === p ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-input hover:bg-accent')
                    }
                  >
                    <input
                      type="radio"
                      name="period"
                      className="accent-brand-600"
                      checked={period === p}
                      onChange={() => setPeriod(p)}
                    />
                    {PERIOD_LABEL[p]}
                  </label>
                ))}
              </div>
            </div>

            {period === 'CUSTOM' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="periodStart">Du</Label>
                  <Input
                    id="periodStart"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="periodEnd">Au</Label>
                  <Input
                    id="periodEnd"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Step 2 — Sections */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sections du rapport</CardTitle>
            <CardDescription>Choisis les sections à inclure. Toutes sont activées par défaut.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {SECTION_DEFS.map((s) => (
              <label
                key={s.key}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3 transition-colors hover:bg-accent"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                  checked={sections[s.key]}
                  onChange={() => toggleSection(s.key)}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.description}</div>
                </div>
              </label>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Step 3 — Marque blanche */}
      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Marque blanche</CardTitle>
            <CardDescription>Personnalise l’apparence du rapport avec ton identité d’agence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Live preview */}
            <div className="space-y-2">
              <Label>Aperçu de l’en-tête</Label>
              <div className="overflow-hidden rounded-lg border">
                <div
                  className="flex items-center justify-between gap-3 px-5 py-4"
                  style={{
                    background: `linear-gradient(135deg, ${wl.primaryColor}, ${wl.accentColor})`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {wl.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={wl.logoUrl}
                        alt="logo"
                        className="h-9 w-9 rounded bg-white/90 object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded bg-white/20 text-white">
                        <FileBarChart className="h-5 w-5" />
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-bold text-white drop-shadow">
                        {title.trim() || 'Rapport de performance'}
                      </div>
                      <div className="text-[11px] text-white/80">{wl.agencyName || 'Votre agence'}</div>
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                  >
                    {PERIOD_LABEL[period]}
                  </span>
                </div>
                {wl.footerText ? (
                  <div className="bg-muted px-5 py-2 text-[11px] text-muted-foreground">{wl.footerText}</div>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoUrl">URL du logo</Label>
              <Input
                id="logoUrl"
                type="url"
                placeholder="https://exemple.com/logo.png"
                value={wl.logoUrl}
                onChange={(e) => setWl({ ...wl, logoUrl: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="primaryColor">Couleur principale</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="primaryColor"
                    type="color"
                    className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
                    value={wl.primaryColor}
                    onChange={(e) => setWl({ ...wl, primaryColor: e.target.value })}
                  />
                  <Input
                    value={wl.primaryColor}
                    onChange={(e) => setWl({ ...wl, primaryColor: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accentColor">Couleur d’accent</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="accentColor"
                    type="color"
                    className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
                    value={wl.accentColor}
                    onChange={(e) => setWl({ ...wl, accentColor: e.target.value })}
                  />
                  <Input
                    value={wl.accentColor}
                    onChange={(e) => setWl({ ...wl, accentColor: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agencyName">Nom de l’agence</Label>
              <Input
                id="agencyName"
                placeholder="Votre Agence SAS"
                value={wl.agencyName}
                onChange={(e) => setWl({ ...wl, agencyName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="footerText">Texte de pied de page</Label>
              <Textarea
                id="footerText"
                rows={2}
                placeholder="Rapport confidentiel généré par Votre Agence — contact@agence.com"
                value={wl.footerText}
                onChange={(e) => setWl({ ...wl, footerText: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Footer nav */}
      <Card>
        <CardFooter className="flex items-center justify-between p-4">
          <Button type="button" variant="outline" onClick={prev} disabled={step === 0 || submitting}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Précédent
          </Button>

          {progress ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {progress}
            </span>
          ) : null}

          {isLast ? (
            <Button type="button" variant="brand" onClick={onGenerate} disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer le rapport
            </Button>
          ) : (
            <Button type="button" variant="brand" onClick={next} disabled={submitting}>
              Suivant <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
