'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FileDown,
  RefreshCw,
  CalendarPlus,
  Loader2,
  Sparkles,
  TrendingUp,
  TrendingDown,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import {
  PERIOD_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  FREQUENCY_LABEL,
  readWhiteLabel,
  type ReportData,
  type ReportPeriod,
  type ReportStatus,
  type ReportFrequency,
  type WhiteLabel,
} from '../_shared';

type ReportVM = {
  id: string;
  title: string;
  brandId: string | null;
  brandName: string | null;
  period: string;
  sections: string[];
  status: string;
  aiSummary: string | null;
  errorMessage: string | null;
  generatedAt: string | null;
  data: ReportData;
  whiteLabel: Partial<WhiteLabel>;
};

function nf(n: number | null | undefined) {
  return new Intl.NumberFormat('fr-FR').format(n ?? 0);
}

function Delta({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <div className={'flex items-center gap-1 text-xs font-medium ' + (up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {value}%
    </div>
  );
}

export function ReportViewClient({ report }: { report: ReportVM }) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [frequency, setFrequency] = useState<ReportFrequency>('MONTHLY');
  const [recipients, setRecipients] = useState('');

  const status = report.status as ReportStatus;
  const period = report.period as ReportPeriod;
  const wl = readWhiteLabel(report.whiteLabel);
  const has = (s: string) => report.sections.includes(s);

  const overview = report.data.overview;
  const delta = overview?.deltaVsPrevious;
  const engagementSeries = report.data.engagement?.timeseries ?? [];
  const platforms = report.data.platforms ?? [];
  const topPosts = report.data.topPosts ?? [];
  const competitors = report.data.competitors ?? [];

  async function onRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/reports/${report.id}/generate`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Régénération impossible (HTTP ${res.status})`);
      }
      toast.success('Rapport régénéré');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setRegenerating(false);
    }
  }

  async function onSchedule() {
    const recipientList = recipients
      .split(/[,\n;]/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (recipientList.length === 0) {
      toast.error('Ajoute au moins un destinataire (email)');
      return;
    }
    setScheduling(true);
    try {
      const res = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: report.title,
          ...(report.brandId ? { brandId: report.brandId } : {}),
          period: report.period,
          sections: report.sections,
          frequency,
          recipients: recipientList,
          whiteLabel: wl,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Programmation impossible (HTTP ${res.status})`);
      }
      toast.success('Rapport programmé');
      setScheduleOpen(false);
      router.push('/reports');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setScheduling(false);
    }
  }

  const generating = status === 'GENERATING';
  const failed = status === 'FAILED';

  // KPI tiles built from the overview block (mirrors the PDF).
  const kpiTiles = overview
    ? [
        { label: 'Publications', value: nf(overview.totalPosts), delta: delta?.posts },
        { label: 'Impressions', value: nf(overview.totalImpressions), delta: delta?.impressions },
        { label: 'Engagement', value: nf(overview.totalEngagement), delta: delta?.engagement },
        { label: 'Portée', value: nf(overview.totalReach), delta: delta?.reach },
        {
          label: "Taux d'engagement",
          value: `${overview.avgEngagementRate}%`,
          delta: delta?.engagementRatePct,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{report.brandName ?? 'Toutes les marques'}</span>
            <span>·</span>
            <span>{PERIOD_LABEL[period] ?? report.period}</span>
            <Badge variant={STATUS_VARIANT[status]} className="text-[10px]">
              {STATUS_LABEL[status]}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button variant="brand" disabled={status !== 'READY'}>
              <FileDown className="mr-2 h-4 w-4" /> Télécharger le PDF
            </Button>
          </a>
          <Button variant="outline" onClick={onRegenerate} disabled={regenerating || generating}>
            {regenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Régénérer
          </Button>
          <Button variant="outline" onClick={() => setScheduleOpen(true)}>
            <CalendarPlus className="mr-2 h-4 w-4" /> Programmer ce rapport
          </Button>
        </div>
      </div>

      {/* White-label header band — mirrors the PDF */}
      <div className="overflow-hidden rounded-xl border shadow-sm">
        <div
          className="flex items-center justify-between gap-3 px-6 py-5"
          style={{ background: `linear-gradient(135deg, ${wl.primaryColor}, ${wl.accentColor})` }}
        >
          <div className="flex items-center gap-3">
            {wl.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={wl.logoUrl} alt="logo" className="h-11 w-11 rounded bg-white/90 object-contain p-1" />
            ) : null}
            <div>
              <div className="text-lg font-bold text-white drop-shadow">{report.title}</div>
              <div className="text-xs text-white/80">
                {wl.agencyName || report.brandName || 'Rapport de performance'}
              </div>
            </div>
          </div>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
            {PERIOD_LABEL[period] ?? report.period}
          </span>
        </div>
        {wl.footerText ? (
          <div className="bg-muted px-6 py-2 text-xs text-muted-foreground">{wl.footerText}</div>
        ) : null}
      </div>

      {generating ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Le rapport est en cours de génération…
          </CardContent>
        </Card>
      ) : null}

      {failed ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">
            La génération a échoué. {report.errorMessage ?? ''} Tu peux relancer avec «&nbsp;Régénérer&nbsp;».
          </CardContent>
        </Card>
      ) : null}

      {/* Overview — KPI tiles */}
      {has('overview') && kpiTiles.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Vue d’ensemble</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {kpiTiles.map((k, i) => (
              <Card key={i}>
                <CardContent className="space-y-1 p-4">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className="text-2xl font-bold tracking-tight">{k.value}</div>
                  <Delta value={k.delta} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* AI summary */}
      {has('ai-summary') && report.aiSummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" /> Résumé IA
            </CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-line text-sm leading-relaxed text-foreground">
            {report.aiSummary}
          </CardContent>
        </Card>
      ) : null}

      {/* Engagement chart */}
      {has('engagement') && engagementSeries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Engagement</CardTitle>
            <CardDescription>Évolution de l’engagement et des impressions sur la période.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={engagementSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={wl.primaryColor} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={wl.primaryColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="engagement"
                    stroke={wl.primaryColor}
                    fill="url(#eng)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Platforms */}
      {has('platforms') && platforms.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Plateformes</CardTitle>
            <CardDescription>Performances par réseau social.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platforms} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="engagement" fill={wl.accentColor} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Plateforme</th>
                    <th className="py-2 text-right font-medium">Publications</th>
                    <th className="py-2 text-right font-medium">Impressions</th>
                    <th className="py-2 text-right font-medium">Engagement</th>
                    <th className="py-2 text-right font-medium">Taux</th>
                  </tr>
                </thead>
                <tbody>
                  {platforms.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{p.platform}</td>
                      <td className="py-2 text-right">{nf(p.posts)}</td>
                      <td className="py-2 text-right">{nf(p.impressions)}</td>
                      <td className="py-2 text-right">{nf(p.engagement)}</td>
                      <td className="py-2 text-right">
                        {p.engagementRate != null ? `${p.engagementRate}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Top posts */}
      {has('top-posts') && topPosts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Top publications</CardTitle>
            <CardDescription>Les publications les plus performantes de la période.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Publication</th>
                  <th className="py-2 font-medium">Plateforme</th>
                  <th className="py-2 text-right font-medium">Impressions</th>
                  <th className="py-2 text-right font-medium">Engagement</th>
                  <th className="py-2 text-right font-medium">Taux</th>
                </tr>
              </thead>
              <tbody>
                {topPosts.map((p, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="max-w-xs truncate py-2 font-medium">{p.title}</td>
                    <td className="py-2 text-muted-foreground">{p.platform ?? '—'}</td>
                    <td className="py-2 text-right">{nf(p.impressions)}</td>
                    <td className="py-2 text-right">{nf(p.engagement)}</td>
                    <td className="py-2 text-right">
                      {p.engagementRate != null ? `${p.engagementRate}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* Competitors */}
      {has('competitors') && competitors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Concurrents</CardTitle>
            <CardDescription>Comparaison avec les concurrents suivis.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Concurrent</th>
                  <th className="py-2 text-right font-medium">Publications</th>
                  <th className="py-2 text-right font-medium">Engagement moyen / post</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="py-2 text-right">{nf(c.posts)}</td>
                    <td className="py-2 text-right">{nf(c.avgEngagement)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* Schedule dialog */}
      {scheduleOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !scheduling && setScheduleOpen(false)}
        >
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Programmer ce rapport</CardTitle>
                <CardDescription>Génère et envoie automatiquement ce rapport.</CardDescription>
              </div>
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="frequency">Fréquence</Label>
                <select
                  id="frequency"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
                >
                  {(['WEEKLY', 'MONTHLY', 'QUARTERLY'] as ReportFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABEL[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipients">Destinataires (emails, séparés par des virgules)</Label>
                <Input
                  id="recipients"
                  placeholder="client@exemple.com, manager@exemple.com"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setScheduleOpen(false)} disabled={scheduling}>
                  Annuler
                </Button>
                <Button variant="brand" onClick={onSchedule} disabled={scheduling}>
                  {scheduling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Programmer
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
