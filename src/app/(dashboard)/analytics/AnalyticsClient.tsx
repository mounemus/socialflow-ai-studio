'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { BarChart3, Trophy, TrendingUp, Eye, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Hex colors consistent with the calendar legend (CalendarClient PLATFORM_COLORS).
export const PLATFORM_HEX: Record<string, string> = {
  INSTAGRAM: '#ec4899', // pink-500
  FACEBOOK: '#2563eb', // blue-600
  LINKEDIN: '#0369a1', // sky-700 (blue-700 family)
  TWITTER: '#0ea5e9', // sky-500
  TIKTOK: '#000000', // black
  YOUTUBE: '#dc2626', // red-600
  PINTEREST: '#dc2626', // red-600
};

const PLATFORM_LABEL: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  TWITTER: 'Twitter / X',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  PINTEREST: 'Pinterest',
};

function platformColor(p: string): string {
  return PLATFORM_HEX[p] ?? '#64748b';
}

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p;
}

export type ComparisonRow = {
  platform: string;
  posts: number;
  impressions: number;
  reach: number;
  engagement: number;
  clicks: number;
  engagementRate: number;
  avgPerPost: number;
  deltaVsPrev: number;
};

export type ComparisonSummary = {
  bestByEngagement: string | null;
  bestByReach: string | null;
  fastestGrowing: string | null;
};

export type TimeseriesPoint = { date: string } & Record<string, number | string>;

export type BrandOption = { id: string; name: string };

export type AnalyticsClientProps = {
  kpis: {
    posts: number;
    impressions: number;
    reach: number;
    engagement: number;
  };
  rows: ComparisonRow[];
  summary: ComparisonSummary;
  timeseries: TimeseriesPoint[];
  activePlatforms: string[];
  brands: BrandOption[];
  period: number; // days
  brandId: string | null;
};

const PERIODS: { days: number; label: string }[] = [
  { days: 7, label: '7 j' },
  { days: 30, label: '30 j' },
  { days: 90, label: '90 j' },
];

function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export function AnalyticsClient({
  kpis,
  rows,
  summary,
  timeseries,
  activePlatforms,
  brands,
  period,
  brandId,
}: AnalyticsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
      startTransition(() => {
        router.replace(`/analytics?${params.toString()}`, { scroll: false });
      });
    },
    [router, searchParams],
  );

  // Des rows existent dès qu'il y a de vraies publications, même avant que
  // les métriques (impressions/engagement...) n'aient été collectées —
  // l'état vide ne doit donc s'afficher que sans aucune publication réelle.
  const hasPosts = kpis.posts > 0 || rows.length > 0;
  const metricsPending =
    hasPosts && kpis.impressions === 0 && kpis.reach === 0 && kpis.engagement === 0;
  const xInterval = timeseries.length > 12 ? Math.floor(timeseries.length / 8) : 0;

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="h-6 w-6 text-brand-600" /> Analytique
          </h1>
          <p className="text-sm text-muted-foreground">
            Comparaison des réseaux et indicateurs agrégés sur l&apos;ensemble des marques.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {pending ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}

          {/* Brand filter */}
          {brands.length > 0 ? (
            <select
              value={brandId ?? ''}
              onChange={(e) => setParam('brandId', e.target.value || null)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filtrer par marque"
            >
              <option value="">Toutes les marques</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}

          {/* Period selector */}
          <div className="inline-flex rounded-md border border-input bg-background p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setParam('period', String(p.days))}
                className={cn(
                  'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  period === p.days
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Publications" value={kpis.posts} />
        <KpiCard label="Impressions" value={kpis.impressions} />
        <KpiCard label="Portée (reach)" value={kpis.reach} />
        <KpiCard label="Engagement" value={kpis.engagement} />
      </div>

      {!hasPosts ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Pas encore de données analytiques sur cette période — publie et collecte des
            métriques pour comparer tes réseaux.
          </CardContent>
        </Card>
      ) : (
        <>
          {metricsPending ? (
            <p className="text-sm text-muted-foreground">
              Métriques en cours de collecte (synchronisation toutes les 6 h) — les compteurs de
              publications sont réels.
            </p>
          ) : null}

          {/* Comparison summary badges */}
          <div className="grid gap-4 sm:grid-cols-3">
            <BestCard
              icon={<Trophy className="h-5 w-5 text-amber-500" />}
              label="Meilleur engagement"
              platform={summary.bestByEngagement}
            />
            <BestCard
              icon={<Eye className="h-5 w-5 text-sky-500" />}
              label="Meilleure portée"
              platform={summary.bestByReach}
            />
            <BestCard
              icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
              label="Croissance la plus rapide"
              platform={summary.fastestGrowing}
            />
          </div>

          {/* Comparison table */}
          <Card>
            <CardHeader>
              <CardTitle>Comparaison réseaux</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-semibold">Réseau</th>
                    <th className="px-3 py-2 text-right font-semibold">Posts</th>
                    <th className="px-3 py-2 text-right font-semibold">Impressions</th>
                    <th className="px-3 py-2 text-right font-semibold">Reach</th>
                    <th className="px-3 py-2 text-right font-semibold">Engagement</th>
                    <th className="px-3 py-2 text-right font-semibold">Taux d&apos;eng.</th>
                    <th className="px-3 py-2 text-right font-semibold">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isBest = r.platform === summary.bestByEngagement;
                    return (
                      <tr
                        key={r.platform}
                        className={cn(
                          'border-b last:border-0',
                          isBest ? 'bg-amber-50/60' : 'hover:bg-slate-50',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: platformColor(r.platform) }}
                            />
                            <span className="font-medium text-slate-900">
                              {platformLabel(r.platform)}
                            </span>
                            {isBest ? (
                              <Badge className="border-transparent bg-amber-100 text-amber-800">
                                <Trophy className="mr-1 h-3 w-3" /> Meilleur réseau
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.posts)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(r.impressions)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.reach)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                          {fmt(r.engagement)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {r.engagementRate.toLocaleString('fr-FR', {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 2,
                          })}
                          %
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <DeltaBadge value={r.deltaVsPrev} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Multi-line engagement chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Engagement par réseau — {period} jours</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeseries} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      interval={xInterval}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip
                      labelFormatter={(v) => shortDate(String(v))}
                      formatter={(value, name) => [fmt(Number(value)), platformLabel(String(name))]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Legend
                      formatter={(value) => platformLabel(String(value))}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    {activePlatforms.map((p) => (
                      <Line
                        key={p}
                        type="monotone"
                        dataKey={p}
                        name={p}
                        stroke={platformColor(p)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Engagement-rate bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Taux d&apos;engagement par réseau</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rows.map((r) => ({
                      platform: r.platform,
                      label: platformLabel(r.platform),
                      engagementRate: r.engagementRate,
                    }))}
                    margin={{ top: 8, right: 16, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      unit="%"
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      formatter={(value) => [`${Number(value).toFixed(2)}%`, "Taux d'engagement"]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Bar dataKey="engagementRate" radius={[4, 4, 0, 0]}>
                      {rows.map((r) => (
                        <Cell key={r.platform} fill={platformColor(r.platform)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">{fmt(value)}</div>
      </CardContent>
    </Card>
  );
}

function BestCard({
  icon,
  label,
  platform,
}: {
  icon: React.ReactNode;
  label: string;
  platform: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {label}
          </div>
          {platform ? (
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: platformColor(platform) }}
              />
              <span className="text-base font-semibold text-slate-900">
                {platformLabel(platform)}
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-base font-semibold text-slate-400">—</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) {
    return <span className="text-slate-400">—</span>;
  }
  const positive = value > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
        positive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
      )}
    >
      {positive ? '+' : ''}
      {value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%
    </span>
  );
}
