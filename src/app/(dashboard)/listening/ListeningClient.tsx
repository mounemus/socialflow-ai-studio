'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Ear,
  Globe,
  MessageSquare,
  Newspaper,
  Twitter,
  Smile,
  Frown,
  Meh,
  ExternalLink,
  Inbox,
  Check,
  EyeOff,
  Search,
  Settings2,
  AlertTriangle,
  AlertOctagon,
  Loader2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export type Mention = {
  id: string;
  source: string; // REDDIT | WEB | NEWS | TWITTER
  author: string;
  authorHandle: string | null;
  content: string;
  url: string | null;
  sentiment: Sentiment;
  relevance: number; // 0..1
  status: string; // NEW | PROCESSED | IGNORED
  publishedAt: string;
  watchId: string | null;
  watchName: string | null;
  brandName: string | null;
};

export type ListeningAlert = {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  message: string | null;
  watchId: string | null;
  createdAt: string;
};

export type WatchLite = { id: string; name: string; active: boolean };

const SOURCES = ['REDDIT', 'WEB', 'NEWS', 'TWITTER'] as const;
const STATUSES = ['NEW', 'PROCESSED', 'IGNORED'] as const;

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diffSec = Math.floor((Date.now() - d) / 1000);
  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

function sourceIcon(source: string) {
  const s = source.toUpperCase();
  if (s.includes('REDDIT')) return <MessageSquare className="h-4 w-4 text-orange-500" />;
  if (s.includes('NEWS')) return <Newspaper className="h-4 w-4 text-violet-500" />;
  if (s.includes('TWITTER') || s === 'X') return <Twitter className="h-4 w-4 text-sky-500" />;
  return <Globe className="h-4 w-4 text-slate-500" />;
}

function sourceLabel(source: string): string {
  const s = source.toUpperCase();
  if (s.includes('REDDIT')) return 'Reddit';
  if (s.includes('NEWS')) return 'News';
  if (s.includes('TWITTER') || s === 'X') return 'Twitter';
  return 'Web';
}

function sentimentChip(s: Sentiment) {
  if (s === 'POSITIVE')
    return (
      <Badge className="border-transparent bg-emerald-100 text-emerald-800">
        <Smile className="mr-1 h-3 w-3" /> Positif
      </Badge>
    );
  if (s === 'NEGATIVE')
    return (
      <Badge className="border-transparent bg-rose-100 text-rose-800">
        <Frown className="mr-1 h-3 w-3" /> Négatif
      </Badge>
    );
  return (
    <Badge className="border-transparent bg-slate-100 text-slate-700">
      <Meh className="mr-1 h-3 w-3" /> Neutre
    </Badge>
  );
}

export function ListeningClient({
  initialMentions,
  initialAlerts,
  watches,
}: {
  initialMentions: Mention[];
  initialAlerts: ListeningAlert[];
  watches: WatchLite[];
}) {
  const [mentions, setMentions] = useState<Mention[]>(initialMentions);
  const [alerts, setAlerts] = useState<ListeningAlert[]>(initialAlerts);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>('NEW');
  const [watchFilter, setWatchFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Poll for new mentions + alerts every 30s
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch('/api/listening/mentions?limit=100', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          mentions?: Mention[];
          alerts?: ListeningAlert[];
        };
        if (Array.isArray(data.mentions)) setMentions(data.mentions);
        if (Array.isArray(data.alerts)) setAlerts(data.alerts);
      } catch {
        // ignore — keep current state
      }
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- Summary stats ----
  const summary = useMemo(() => {
    let pos = 0;
    let neg = 0;
    let neu = 0;
    for (const m of mentions) {
      if (m.sentiment === 'POSITIVE') pos += 1;
      else if (m.sentiment === 'NEGATIVE') neg += 1;
      else neu += 1;
    }
    return { pos, neg, neu, total: mentions.length };
  }, [mentions]);

  // ---- Timeline (last 30 days) ----
  const timeline = useMemo(() => {
    const days: { key: string; label: string; POSITIVE: number; NEGATIVE: number; NEUTRAL: number }[] =
      [];
    const byDay = new Map<string, { POSITIVE: number; NEGATIVE: number; NEUTRAL: number }>();
    const now = new Date();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 });
      days.push({
        key,
        label: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        POSITIVE: 0,
        NEGATIVE: 0,
        NEUTRAL: 0,
      });
    }
    for (const m of mentions) {
      const key = m.publishedAt.slice(0, 10);
      const bucket = byDay.get(key);
      if (bucket) bucket[m.sentiment] += 1;
    }
    return days.map((d) => {
      const b = byDay.get(d.key)!;
      return { ...d, ...b };
    });
  }, [mentions]);

  // ---- Source breakdown ----
  const sourceBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mentions) {
      const label = sourceLabel(m.source);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [mentions]);

  // ---- Watch counts (derived for filter labels) ----
  const watchOptions = useMemo(() => {
    const named = new Map<string, string>();
    for (const w of watches) named.set(w.id, w.name);
    mentions.forEach((m) => {
      if (m.watchId && m.watchName && !named.has(m.watchId)) named.set(m.watchId, m.watchName);
    });
    return Array.from(named.entries()).map(([id, name]) => ({ id, name }));
  }, [watches, mentions]);

  // ---- Filtered feed ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mentions
      .filter((m) => {
        if (sourceFilter && sourceLabel(m.source).toUpperCase() !== sourceFilter) return false;
        if (sentimentFilter && m.sentiment !== sentimentFilter) return false;
        if (statusFilter && m.status.toUpperCase() !== statusFilter) return false;
        if (watchFilter && m.watchId !== watchFilter) return false;
        if (q) {
          const hay = `${m.author} ${m.authorHandle ?? ''} ${m.content} ${m.watchName ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }, [mentions, sourceFilter, sentimentFilter, statusFilter, watchFilter, search]);

  const updateLocal = useCallback((id: string, patch: Partial<Mention>) => {
    setMentions((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    try {
      const res = await fetch(`/api/listening/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('ack failed');
    } catch {
      toast.error("Impossible d'acquitter l'alerte");
    }
  }, []);

  const setStatus = useCallback(
    async (id: string, status: 'PROCESSED' | 'IGNORED') => {
      setBusyId(id);
      const prev = mentions.find((m) => m.id === id)?.status;
      updateLocal(id, { status });
      try {
        const res = await fetch(`/api/listening/mentions/${encodeURIComponent(id)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error('status failed');
        toast.success(status === 'PROCESSED' ? 'Mention traitée' : 'Mention ignorée');
      } catch {
        updateLocal(id, { status: prev ?? 'NEW' });
        toast.error('Échec de la mise à jour');
      } finally {
        setBusyId(null);
      }
    },
    [mentions, updateLocal],
  );

  const addToInbox = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const res = await fetch(`/api/listening/mentions/${encodeURIComponent(id)}/to-inbox`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('to-inbox failed');
        toast.success("Ajouté à la boîte de réception");
        updateLocal(id, { status: 'PROCESSED' });
      } catch {
        toast.error("Échec de l'ajout à l'inbox");
      } finally {
        setBusyId(null);
      }
    },
    [updateLocal],
  );

  const hasActiveWatch = watches.length > 0 || mentions.length > 0;

  if (!hasActiveWatch) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          icon={<Ear className="h-10 w-10" />}
          title="Aucune veille active"
          description="Crée une veille de mentions pour suivre ta marque sur Reddit, le web, la presse et Twitter."
          action={
            <Link href="/listening/watches">
              <Button variant="brand">Créer une veille de mentions</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      {/* Active alerts banner */}
      {alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((a) => {
            const critical = a.severity === 'CRITICAL';
            return (
              <div
                key={a.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3',
                  critical
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900',
                )}
              >
                {critical ? (
                  <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={critical ? 'destructive' : 'warning'} className="text-[10px]">
                      {a.severity}
                    </Badge>
                    <span className="text-sm font-semibold">{a.title}</span>
                    <span className="ml-auto text-[11px] opacity-70">{relativeTime(a.createdAt)}</span>
                  </div>
                  {a.message ? <p className="mt-0.5 text-xs">{a.message}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (a.watchId) setWatchFilter(a.watchId);
                      setStatusFilter('NEW');
                      setSentimentFilter('NEGATIVE');
                      document.getElementById('mentions-feed')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    Voir les mentions
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => acknowledgeAlert(a.id)}>
                    <Check className="mr-1 h-4 w-4" /> Acquitter
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Positives"
          value={summary.pos}
          total={summary.total}
          icon={<Smile className="h-5 w-5 text-emerald-500" />}
          accent="text-emerald-600"
          onClick={() => setSentimentFilter((p) => (p === 'POSITIVE' ? null : 'POSITIVE'))}
          active={sentimentFilter === 'POSITIVE'}
        />
        <SummaryCard
          label="Négatives"
          value={summary.neg}
          total={summary.total}
          icon={<Frown className="h-5 w-5 text-rose-500" />}
          accent="text-rose-600"
          onClick={() => setSentimentFilter((p) => (p === 'NEGATIVE' ? null : 'NEGATIVE'))}
          active={sentimentFilter === 'NEGATIVE'}
        />
        <SummaryCard
          label="Neutres"
          value={summary.neu}
          total={summary.total}
          icon={<Meh className="h-5 w-5 text-slate-400" />}
          accent="text-slate-600"
          onClick={() => setSentimentFilter((p) => (p === 'NEUTRAL' ? null : 'NEUTRAL'))}
          active={sentimentFilter === 'NEUTRAL'}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Évolution du sentiment — 30 jours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gNeu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    interval={4}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="POSITIVE"
                    name="Positif"
                    stroke="#10b981"
                    fill="url(#gPos)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="NEGATIVE"
                    name="Négatif"
                    stroke="#f43f5e"
                    fill="url(#gNeg)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="NEUTRAL"
                    name="Neutre"
                    stroke="#94a3b8"
                    fill="url(#gNeu)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sources</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceBreakdown.length === 0 ? (
              <p className="py-12 text-center text-xs text-slate-500">Aucune donnée</p>
            ) : (
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sourceBreakdown}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                  >
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {sourceBreakdown.map((entry, i) => (
                        <Cell
                          key={entry.name}
                          fill={['#6366f1', '#f97316', '#8b5cf6', '#0ea5e9'][i % 4]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="h-9 w-48 pl-8"
            />
          </div>

          <FilterChipGroup label="Source">
            {SOURCES.map((s) => (
              <Chip
                key={s}
                active={sourceFilter === s}
                onClick={() => setSourceFilter((p) => (p === s ? null : s))}
              >
                {sourceLabel(s)}
              </Chip>
            ))}
          </FilterChipGroup>

          <FilterChipGroup label="Statut">
            {STATUSES.map((s) => (
              <Chip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter((p) => (p === s ? null : s))}
              >
                {s === 'NEW' ? 'Nouveau' : s === 'PROCESSED' ? 'Traité' : 'Ignoré'}
              </Chip>
            ))}
          </FilterChipGroup>

          {watchOptions.length > 0 ? (
            <FilterChipGroup label="Veille">
              {watchOptions.map((w) => (
                <Chip
                  key={w.id}
                  active={watchFilter === w.id}
                  onClick={() => setWatchFilter((p) => (p === w.id ? null : w.id))}
                >
                  {w.name}
                </Chip>
              ))}
            </FilterChipGroup>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {(sourceFilter || sentimentFilter || statusFilter || watchFilter || search) ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSourceFilter(null);
                  setSentimentFilter(null);
                  setStatusFilter(null);
                  setWatchFilter(null);
                  setSearch('');
                }}
              >
                Réinitialiser
              </Button>
            ) : null}
            <Link href="/listening/watches">
              <Button size="sm" variant="outline">
                <Settings2 className="mr-1 h-4 w-4" /> Veilles
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Mentions feed */}
      <div id="mentions-feed" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-slate-700">
            {filtered.length} mention{filtered.length > 1 ? 's' : ''}
          </h2>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-slate-500">
              Aucune mention ne correspond à ces filtres.
            </CardContent>
          </Card>
        ) : (
          filtered.map((m) => {
            const busy = busyId === m.id;
            return (
              <Card key={m.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
                      {sourceIcon(m.source)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{m.author}</span>
                        {m.authorHandle ? (
                          <span className="text-xs text-slate-500">{m.authorHandle}</span>
                        ) : null}
                        <Badge variant="outline" className="text-[10px]">
                          {sourceLabel(m.source)}
                        </Badge>
                        {sentimentChip(m.sentiment)}
                        <Badge
                          variant="secondary"
                          className="text-[10px]"
                          title="Pertinence"
                        >
                          {Math.round((m.relevance ?? 0) * 100)}% pertinent
                        </Badge>
                        {m.watchName ? (
                          <Badge variant="info" className="text-[10px]">
                            {m.watchName}
                          </Badge>
                        ) : null}
                        {m.status.toUpperCase() === 'PROCESSED' ? (
                          <Badge variant="success" className="text-[10px]">
                            Traité
                          </Badge>
                        ) : m.status.toUpperCase() === 'IGNORED' ? (
                          <Badge variant="outline" className="text-[10px] text-slate-400">
                            Ignoré
                          </Badge>
                        ) : null}
                        <span className="ml-auto text-[11px] text-slate-400">
                          {relativeTime(m.publishedAt)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-700">
                        {m.content}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {m.url ? (
                          <a href={m.url} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline">
                              <ExternalLink className="mr-1 h-4 w-4" /> Ouvrir la source
                            </Button>
                          </a>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => addToInbox(m.id)}
                        >
                          {busy ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Inbox className="mr-1 h-4 w-4" />
                          )}
                          Ajouter à l&apos;inbox
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || m.status.toUpperCase() === 'PROCESSED'}
                          onClick={() => setStatus(m.id, 'PROCESSED')}
                        >
                          <Check className="mr-1 h-4 w-4" /> Marquer traité
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || m.status.toUpperCase() === 'IGNORED'}
                          onClick={() => setStatus(m.id, 'IGNORED')}
                        >
                          <EyeOff className="mr-1 h-4 w-4" /> Ignorer
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Ear className="h-6 w-6 text-brand-600" /> Social Listening
        </h1>
        <p className="text-sm text-muted-foreground">
          Suis les mentions de ta marque, le sentiment et les alertes en temps réel.
        </p>
      </div>
      <Link href="/listening/watches">
        <Button variant="brand">
          <Settings2 className="mr-2 h-4 w-4" /> Gérer les veilles
        </Button>
      </Link>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  total,
  icon,
  accent,
  onClick,
  active,
}: {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  accent: string;
  onClick: () => void;
  active: boolean;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow',
        active ? 'ring-2 ring-brand-500' : '',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {icon}
      </div>
      <div className={cn('mt-2 text-3xl font-bold', accent)}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{pct}% des mentions</div>
    </button>
  );
}

function FilterChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 text-slate-600 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}
