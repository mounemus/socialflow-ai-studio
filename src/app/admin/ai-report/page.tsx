'use client';
import { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Metric = {
  provider: string;
  requests: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  byHour?: { hour: string; requests: number; failures: number }[];
  score: number;
};

type RoutingPlan = {
  task: string;
  primary: { provider: string };
  fallbacks: { provider: string }[];
  reasonChosen: string;
  available: boolean;
};

type Report = {
  availability: { id: string; label: string; available: boolean }[];
  routingPlans: RoutingPlan[];
  metrics: Metric[];
  overview: { windowDays: number; totalRequests: number; successRate: number; errorsLast24h: number };
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97757',
  openai: '#10a37f',
  gemini: '#4285f4',
  replicate: '#000000',
  stability: '#7c3aed',
  mock: '#94a3b8',
};

const TASK_GROUPS: Record<string, string> = {
  TEXT_SHORT_COPY: 'Texte', TEXT_LONGFORM: 'Texte', TEXT_STRATEGIC: 'Texte',
  TEXT_STRUCTURED_JSON: 'Texte', TEXT_AD_VARIANTS: 'Texte', TEXT_REEL_SCRIPT: 'Texte',
  TEXT_EMAIL: 'Texte',
  IMAGE_PHOTOREALISTIC: 'Image', IMAGE_ARTISTIC: 'Image',
  IMAGE_AD_WITH_TEXT: 'Image', IMAGE_REEL_THUMBNAIL: 'Image',
  VISION_DESCRIBE: 'Vision', VISION_BRAND_AUDIT: 'Vision', VISION_OCR: 'Vision',
  RESEARCH_GROUNDED: 'Research',
  LONG_CONTEXT_ANALYSIS: 'Long context',
  AGENT_TOOL_USE: 'Agent',
};

export default function AIReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);

  async function load(d = days) {
    setLoading(true);
    const res = await fetch(`/api/admin/ai-report?days=${d}`);
    setLoading(false);
    if (res.ok) setReport((await res.json()).data);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  function changeDays(d: number) { setDays(d); load(d); }

  if (!report) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tasksByGroup: Record<string, RoutingPlan[]> = {};
  for (const p of report.routingPlans) {
    const g = TASK_GROUPS[p.task] ?? 'Autre';
    (tasksByGroup[g] ||= []).push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rapport système IA</h1>
          <p className="text-sm text-muted-foreground">
            Stratégie de routage par tâche + métriques de fiabilité live ({days} derniers jours, données AIRequest table).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-md border px-2 py-1 text-xs" value={days} onChange={(e) => changeDays(parseInt(e.target.value, 10))}>
            <option value="1">1 jour</option>
            <option value="7">7 jours</option>
            <option value="14">14 jours</option>
            <option value="30">30 jours</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* === OVERVIEW === */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Requêtes totales</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{report.overview.totalRequests.toLocaleString('fr-FR')}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Succès global</CardTitle></CardHeader>
          <CardContent>
            <div className={cn(
              'text-2xl font-bold',
              report.overview.successRate > 0.95 ? 'text-emerald-600' : report.overview.successRate > 0.85 ? 'text-amber-600' : 'text-rose-600',
            )}>
              {(report.overview.successRate * 100).toFixed(1)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Erreurs 24h</CardTitle></CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-bold', report.overview.errorsLast24h === 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {report.overview.errorsLast24h}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Coût estimé (USD)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${report.metrics.reduce((s, m) => s + m.estimatedCostUSD, 0).toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* === PROVIDER AVAILABILITY === */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Disponibilité des providers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
            {report.availability.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded border p-2 text-xs">
                {p.available ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <XCircle className="h-3 w-3 text-slate-400" />}
                <span className={p.available ? '' : 'text-slate-400'}>{p.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* === RELIABILITY PER PROVIDER === */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Fiabilité par provider</h2>
        {report.metrics.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Pas encore de requêtes IA enregistrées. Les métriques apparaîtront dès la première utilisation du studio IA ou de l'assistant.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {report.metrics.map((m) => (
              <Card key={m.provider} className={cn(
                m.score >= 90 ? 'border-emerald-300' : m.score >= 70 ? 'border-amber-300' : 'border-rose-300',
              )}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[m.provider] ?? '#666' }} />
                      {m.provider}
                    </span>
                    <Badge variant={m.score >= 90 ? 'success' : m.score >= 70 ? 'warning' : 'destructive'}>
                      Score {m.score}/100
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Requêtes" value={m.requests.toLocaleString('fr-FR')} />
                    <Stat label="Succès" value={`${(m.successRate * 100).toFixed(1)}%`} ok={m.successRate > 0.95} />
                    <Stat label="Latence p50" value={`${m.p50LatencyMs}ms`} ok={m.p50LatencyMs < 3000} />
                    <Stat label="Latence p95" value={`${m.p95LatencyMs}ms`} ok={m.p95LatencyMs < 8000} />
                    <Stat label="Tokens in" value={(m.totalInputTokens || 0).toLocaleString('fr-FR')} />
                    <Stat label="Tokens out" value={(m.totalOutputTokens || 0).toLocaleString('fr-FR')} />
                    <Stat label="Coût estimé" value={`$${m.estimatedCostUSD.toFixed(4)}`} />
                  </div>
                  {m.lastErrorMessage ? (
                    <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs">
                      <AlertTriangle className="mr-1 inline h-3 w-3 text-rose-600" />
                      <span className="text-rose-900">{m.lastErrorMessage.slice(0, 200)}</span>
                    </div>
                  ) : null}
                  {m.byHour && m.byHour.length > 0 ? (
                    <ResponsiveContainer width="100%" height={80}>
                      <BarChart data={m.byHour}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="hour" tickFormatter={(h) => h.slice(11)} fontSize={9} />
                        <YAxis hide />
                        <Tooltip labelFormatter={(h) => `${h}h`} />
                        <Bar dataKey="requests" fill={PROVIDER_COLORS[m.provider] ?? '#666'} />
                        <Bar dataKey="failures" fill="#e11d48" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* === ROUTING STRATEGY === */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Stratégie de routage par tâche</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{report.routingPlans.length} types de tâches définies</CardTitle>
            <CardDescription>Chaque tâche est assignée au provider le plus adapté avec fallback chain.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {Object.entries(tasksByGroup).map(([group, tasks]) => (
              <div key={group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{group}</h3>
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <div key={t.task} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-mono text-xs">{t.task}</div>
                        <div className="flex items-center gap-1">
                          <Badge variant={t.available ? 'success' : 'destructive'} className="text-[10px]">
                            {t.available ? `→ ${t.primary.provider}` : 'indisponible'}
                          </Badge>
                          {t.fallbacks.length > 0 ? (
                            <span className="text-[10px] text-muted-foreground">
                              fallback: {t.fallbacks.map((f) => f.provider).join(' → ')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{t.reasonChosen}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded border bg-slate-50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-sm', ok === false && 'text-rose-600', ok === true && 'text-emerald-600')}>{value}</div>
    </div>
  );
}
