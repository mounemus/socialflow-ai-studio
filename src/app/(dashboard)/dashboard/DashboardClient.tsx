'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Sparkles, Calendar, FileText, Image as ImageIcon, Megaphone, Radar, Bot, Plus,
  TrendingUp, Eye, Heart, MessageSquare, Share2, MousePointerClick, Loader2,
  Lightbulb, AlertTriangle, ArrowRight, ExternalLink, Activity,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Stats = {
  posts: number; scheduled: number; published: number; failed: number;
  impressions: number; likes: number; comments: number; shares: number; clicks: number;
  engagementRate: number;
  brands: number; accounts: number;
};

type TimePoint = { date: string; impressions: number; engagement: number };
type ByPlatform = Record<string, { impressions: number; engagement: number; posts: number }>;

interface RecentPost { id: string; title: string; brandName: string | null; format: string; status: string; updatedAt: string }
interface UpcomingSchedule { id: string; scheduledFor: string; platform: string | null; brandName: string | null; postTitle: string }
interface AgentRun { id: string; kind: string; status: string; title: string; createdAt: string }
interface TopTrend { id: string; title: string; url: string | null; score: number }
interface Brand { id: string; name: string }

type BriefData = {
  configured?: boolean;
  message?: string;
  brand?: { id: string; name: string };
  dataPoints?: { trendItems: number; competitorPosts: number; recentPosts: number };
  brief?: {
    summary: string;
    insights: string[];
    opportunities: string[];
    risks: string[];
    suggestedActions: { title: string; description: string; priority: 'high' | 'medium' | 'low' }[];
  };
  generatedAt?: string;
};

const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: '#E1306C', FACEBOOK: '#1877F2', LINKEDIN: '#0A66C2',
  TWITTER: '#1DA1F2', TIKTOK: '#000000', YOUTUBE: '#FF0000', PINTEREST: '#BD081C',
};

export function DashboardClient({
  orgName, userName, stats, timeseries, byPlatform, recentPosts, upcomingSchedules,
  recentAgentRuns, topTrends, brands, planLabel, geminiAvailable,
}: {
  orgName: string;
  userName: string;
  stats: Stats;
  timeseries: TimePoint[];
  byPlatform: ByPlatform;
  recentPosts: RecentPost[];
  upcomingSchedules: UpcomingSchedule[];
  recentAgentRuns: AgentRun[];
  topTrends: TopTrend[];
  brands: Brand[];
  planLabel: string;
  geminiAvailable: boolean;
}) {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>('');

  // Auto-load brief if Gemini available
  useEffect(() => {
    if (geminiAvailable) {
      loadBrief();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBrief(brandId?: string) {
    setLoadingBrief(true);
    const res = await fetch('/api/ai/daily-brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(brandId ? { brandId } : {}),
    });
    setLoadingBrief(false);
    if (!res.ok) return toast.error('Erreur génération brief');
    const { data } = await res.json();
    setBrief(data);
    if (!data.configured) toast.warning(data.message);
    else if (data.brand) toast.success(`Brief généré pour ${data.brand.name}`);
  }

  const platformData = useMemo(() => {
    return Object.entries(byPlatform).map(([k, v]) => ({
      name: k,
      value: v.impressions || v.engagement || v.posts,
      color: PLATFORM_COLORS[k] ?? '#94a3b8',
    }));
  }, [byPlatform]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  return (
    <div className="space-y-6">
      {/* ===== HERO ===== */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{greeting}, {userName}</h1>
            <p className="mt-1 text-white/80">
              <Badge variant="secondary" className="mr-2">{orgName}</Badge>
              <Badge variant="outline" className="border-white/30 text-white">Plan {planLabel}</Badge>
              {' '}· {stats.brands} marque{stats.brands > 1 ? 's' : ''}, {stats.accounts} compte{stats.accounts > 1 ? 's' : ''} social, {stats.posts} publication{stats.posts > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/ai-studio">
              <Button variant="secondary" size="sm">
                <Sparkles className="mr-1 h-3 w-3" /> Studio IA
              </Button>
            </Link>
            <Link href="/assistant">
              <Button variant="secondary" size="sm">
                <Bot className="mr-1 h-3 w-3" /> Assistant
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ===== HERO KPIs ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <KPI icon={Eye} label="Impressions" value={stats.impressions} color="text-violet-600" />
        <KPI icon={Heart} label="Likes" value={stats.likes} color="text-rose-600" />
        <KPI icon={MessageSquare} label="Commentaires" value={stats.comments} color="text-sky-600" />
        <KPI icon={Share2} label="Partages" value={stats.shares} color="text-emerald-600" />
        <KPI icon={MousePointerClick} label="Clics" value={stats.clicks} color="text-amber-600" />
        <KPI icon={TrendingUp} label="Engagement" value={`${(stats.engagementRate * 100).toFixed(1)}%`} color="text-fuchsia-600" />
      </div>

      {/* ===== GEMINI INTELLIGENCE BRIEF ===== */}
      {geminiAvailable ? (
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-violet-700" />
                Intelligence quotidienne <Badge variant="secondary" className="ml-1 bg-violet-100 text-violet-700">Powered by Gemini</Badge>
              </span>
              <div className="flex items-center gap-2">
                {brands.length > 1 ? (
                  <select
                    className="rounded-md border border-violet-200 bg-white px-2 py-1 text-xs"
                    value={selectedBrand}
                    onChange={(e) => { setSelectedBrand(e.target.value); loadBrief(e.target.value || undefined); }}
                  >
                    <option value="">Toutes / 1ère marque</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => loadBrief(selectedBrand || undefined)} disabled={loadingBrief}>
                  {loadingBrief ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Régénérer'}
                </Button>
              </div>
            </CardTitle>
            <CardDescription>
              Analyse croisée de tes tendances, concurrents et publications par Gemini long-context (1M tokens).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBrief && !brief ? (
              <div className="flex items-center gap-2 text-sm text-violet-700">
                <Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours…
              </div>
            ) : !brief?.configured ? (
              <div className="rounded-lg border border-violet-200 bg-white p-3 text-sm">
                <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-600" />
                {brief?.message ?? 'Brief non disponible'}
              </div>
            ) : !brief.brief ? (
              <p className="text-sm text-muted-foreground">Aucune donnée disponible pour générer le brief.</p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed">{brief.brief.summary}</p>

                <div className="grid gap-3 md:grid-cols-2">
                  {brief.brief.insights.length > 0 ? (
                    <div className="rounded-lg border bg-white p-3">
                      <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-violet-700">
                        💡 Insights
                      </div>
                      <ul className="space-y-1 text-xs">
                        {brief.brief.insights.map((i, n) => <li key={n}>· {i}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {brief.brief.opportunities.length > 0 ? (
                    <div className="rounded-lg border bg-white p-3">
                      <div className="mb-1 text-xs font-semibold text-emerald-700">🚀 Opportunités</div>
                      <ul className="space-y-1 text-xs">
                        {brief.brief.opportunities.map((o, n) => <li key={n}>· {o}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {brief.brief.suggestedActions.length > 0 ? (
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-700">Actions suggérées</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {brief.brief.suggestedActions.map((a, n) => (
                        <div key={n} className="rounded-lg border bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">{a.title}</div>
                            <Badge variant={a.priority === 'high' ? 'destructive' : a.priority === 'medium' ? 'warning' : 'secondary'} className="text-[10px]">
                              {a.priority}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {brief.brief.risks.length > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="mb-1 text-xs font-semibold text-amber-800">⚠️ Risques à surveiller</div>
                    <ul className="space-y-1 text-xs text-amber-900">
                      {brief.brief.risks.map((r, n) => <li key={n}>· {r}</li>)}
                    </ul>
                  </div>
                ) : null}

                {brief.dataPoints ? (
                  <p className="text-[10px] text-muted-foreground">
                    Basé sur {brief.dataPoints.trendItems} tendances, {brief.dataPoints.competitorPosts} posts concurrents, {brief.dataPoints.recentPosts} de tes posts.
                    Généré {brief.generatedAt ? new Date(brief.generatedAt).toLocaleTimeString('fr-FR') : ''}.
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Lightbulb className="h-5 w-5 text-slate-400" />
              <div>
                <div className="text-sm font-medium">Intelligence quotidienne Gemini désactivée</div>
                <div className="text-xs text-muted-foreground">
                  Configure GOOGLE_GEMINI_API_KEY pour activer l'analyse stratégique automatique.
                </div>
              </div>
            </div>
            <Link href="/admin/setup/gemini">
              <Button variant="brand" size="sm">Configurer</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ===== CHARTS ===== */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Performance 14 jours</CardTitle>
          </CardHeader>
          <CardContent>
            {timeseries.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                Pas encore de données — publie pour voir les courbes.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeseries}>
                  <defs>
                    <linearGradient id="gradImp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradEng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ec4899" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={(d) => d.slice(5)} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Area type="monotone" dataKey="impressions" stroke="#7c3aed" fill="url(#gradImp)" />
                  <Area type="monotone" dataKey="engagement" stroke="#ec4899" fill="url(#gradEng)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Répartition plateformes</CardTitle>
          </CardHeader>
          <CardContent>
            {platformData.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                Connecte un compte pour voir la répartition.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={platformData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(d) => d.name.slice(0, 3)} labelLine={false}>
                    {platformData.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== QUICK ACTIONS ===== */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/ai-studio', icon: Sparkles, title: 'Studio IA', desc: 'Texte + images IA', color: 'from-violet-500 to-fuchsia-500' },
          { href: '/assistant', icon: Bot, title: 'Assistant', desc: 'Pilote en langage naturel', color: 'from-sky-500 to-cyan-500' },
          { href: '/calendar', icon: Calendar, title: 'Calendrier', desc: 'Planifier les posts', color: 'from-amber-500 to-orange-500' },
          { href: '/marketing-watch', icon: Radar, title: 'Veille', desc: 'Tendances & concurrents', color: 'from-emerald-500 to-teal-500' },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href}>
              <Card className="overflow-hidden transition-shadow hover:shadow-md">
                <div className={cn('h-1 bg-gradient-to-r', a.color)} />
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-slate-700" />
                      <span className="font-medium text-sm">{a.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* ===== ACTIVITY ROW ===== */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Prochaines publications</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingSchedules.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune publication programmée.</p>
            ) : (
              <ul className="space-y-2">
                {upcomingSchedules.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-xs">
                    <Calendar className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.postTitle}</div>
                      <div className="text-muted-foreground">
                        {new Date(s.scheduledFor).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {' · '}{s.platform} · {s.brandName ?? 'sans marque'}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Publications récentes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentPosts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune publication.</p>
            ) : (
              <ul className="space-y-2">
                {recentPosts.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 text-xs">
                    <FileText className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.title}</div>
                      <div className="text-muted-foreground flex gap-1 items-center">
                        <Badge variant="secondary" className="text-[9px]">{p.status}</Badge>
                        <span>· {p.brandName ?? 'sans marque'}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tendances haut score</CardTitle>
          </CardHeader>
          <CardContent>
            {topTrends.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune veille active.</p>
            ) : (
              <ul className="space-y-2">
                {topTrends.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-xs">
                    <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <div className="flex-1 min-w-0">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline line-clamp-2">
                          {t.title}
                        </a>
                      ) : (
                        <div className="font-medium line-clamp-2">{t.title}</div>
                      )}
                      <div className="text-emerald-600 text-[10px]">opportunité {(t.score * 100).toFixed(0)}%</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {recentAgentRuns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4" /> Activité agents IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {recentAgentRuns.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span><Badge variant="secondary" className="text-[9px] mr-1">{r.kind}</Badge>{r.title}</span>
                  <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleTimeString('fr-FR')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function KPI({ icon: Icon, label, value, color }: { icon: typeof Eye; label: string; value: number | string; color: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <Icon className={cn('h-3 w-3', color)} />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <div className="mt-1 text-lg font-bold">
          {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
        </div>
      </CardContent>
    </Card>
  );
}
