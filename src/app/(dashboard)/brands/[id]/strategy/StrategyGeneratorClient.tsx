'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, Check, X, RefreshCw, Rocket, FileText, Calendar, Target,
  Lightbulb, Users, TrendingUp, Megaphone, Mail, Video, GitBranch, Star, AlertTriangle,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Brand { id: string; name: string; industry: string | null; hasProfile: boolean }

interface Item {
  id: string;
  order: number;
  kind: string;
  status: string;
  title: string;
  description: string;
  platform: string | null;
  format: string | null;
  suggestedDate: string | null;
  hashtags: string[];
  cta: string | null;
  postId: string | null;
  campaignId: string | null;
}

interface Strategy {
  id: string;
  title: string;
  status: string;
  horizon: string | null;
  generatedByModel: string | null;
  createdAt: string;
  validatedAt: string | null;
  validatedBy: string | null;
  items: Item[];
  strategy: Record<string, unknown>;
}

const KIND_ICONS: Record<string, typeof FileText> = {
  CONTENT_PILLAR: Target,
  POST_IDEA: FileText,
  CAMPAIGN_IDEA: Megaphone,
  AD_IDEA: TrendingUp,
  EMAIL_IDEA: Mail,
  REEL_IDEA: Video,
  EXPERIMENT: GitBranch,
  PARTNERSHIP: Users,
  MILESTONE: Star,
};

const KIND_COLORS: Record<string, string> = {
  CONTENT_PILLAR: 'text-purple-600 bg-purple-50',
  POST_IDEA: 'text-sky-600 bg-sky-50',
  CAMPAIGN_IDEA: 'text-amber-600 bg-amber-50',
  AD_IDEA: 'text-rose-600 bg-rose-50',
  EMAIL_IDEA: 'text-emerald-600 bg-emerald-50',
  REEL_IDEA: 'text-fuchsia-600 bg-fuchsia-50',
  EXPERIMENT: 'text-cyan-600 bg-cyan-50',
  PARTNERSHIP: 'text-indigo-600 bg-indigo-50',
  MILESTONE: 'text-yellow-600 bg-yellow-50',
};

export function StrategyGeneratorClient({ brand, existingStrategies }: { brand: Brand; existingStrategies: Strategy[] }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [horizon, setHorizon] = useState<'30d' | '90d' | '12mo'>('90d');
  const [extra, setExtra] = useState('');
  const [activeStrategyId, setActiveStrategyId] = useState<string | null>(existingStrategies[0]?.id ?? null);
  const [strategies, setStrategies] = useState<Strategy[]>(existingStrategies);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const active = strategies.find((s) => s.id === activeStrategyId);

  async function generate() {
    if (!brand.hasProfile) {
      const proceed = confirm("La marque n'a pas encore de profil détaillé (mission, audience, ton...). La stratégie sera plus générique. Continuer quand même ?");
      if (!proceed) return;
    }
    setGenerating(true);
    const res = await fetch('/api/strategy/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId: brand.id, horizon, additionalContext: extra }),
    });
    setGenerating(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Génération échouée');
    }
    const { data } = await res.json();
    toast.success(`Stratégie générée ${data.mocked ? '(mock)' : ''} en ${(data.durationMs / 1000).toFixed(1)}s`);
    setStrategies((s) => [data.strategy, ...s]);
    setActiveStrategyId(data.strategy.id);
    setExtra('');
    router.refresh();
  }

  async function validateStrategy(strategyId: string) {
    if (!confirm('Valider cette stratégie ? Tu pourras ensuite approuver chaque item individuellement.')) return;
    setBusy(strategyId);
    const res = await fetch(`/api/strategy/${strategyId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'VALIDATED' }),
    });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Stratégie validée — tu peux maintenant approuver les items');
    setStrategies((s) => s.map((x) => x.id === strategyId ? { ...x, status: 'VALIDATED', validatedAt: new Date().toISOString() } : x));
  }

  async function itemAction(itemId: string, action: 'approve' | 'reject' | 'reset' | 'execute') {
    setBusy(itemId);
    const res = await fetch(`/api/strategy/items/${itemId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur');
    }
    const { data } = await res.json();
    if (action === 'execute') {
      if (data.alreadyExecuted) toast.info('Item déjà exécuté');
      else if (data.postId) toast.success(`Post créé en brouillon — accessible dans /posts`);
      else if (data.campaignId) toast.success(`Campagne créée en brouillon — accessible dans /campaigns`);
      else toast.success('Item exécuté');
      // Reload
      setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
        ...str,
        items: str.items.map((i) => i.id === itemId ? { ...i, status: 'EXECUTED', postId: data.postId ?? null, campaignId: data.campaignId ?? null } : i),
      }));
    } else {
      const newStatus = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'PROPOSED';
      setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
        ...str,
        items: str.items.map((i) => i.id === itemId ? { ...i, status: newStatus } : i),
      }));
      toast.success(action === 'approve' ? 'Approuvé' : action === 'reject' ? 'Rejeté' : 'Réinitialisé');
    }
  }

  async function executeAllApproved() {
    if (!active) return;
    const toExec = active.items.filter((i) => i.status === 'APPROVED');
    if (toExec.length === 0) return toast.info('Aucun item approuvé à exécuter');
    if (!confirm(`Créer ${toExec.length} brouillon${toExec.length > 1 ? 's' : ''} (posts + campagnes) à partir des items approuvés ?`)) return;
    setBusy('execute-all');
    let ok = 0;
    for (const item of toExec) {
      const res = await fetch(`/api/strategy/items/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'execute' }),
      });
      if (res.ok) ok++;
    }
    setBusy(null);
    toast.success(`${ok}/${toExec.length} items exécutés`);
    router.refresh();
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* ===== GENERATOR ===== */}
      <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-violet-700" />
            Générer une nouvelle stratégie
            <Badge variant="secondary" className="bg-violet-100 text-violet-700">Powered by Claude</Badge>
          </CardTitle>
          <CardDescription>
            L'IA utilise le profil de marque, les concurrents identifiés et les plateformes connectées comme contexte stratégique.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Horizon</Label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-violet-200 bg-white px-3 text-sm"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as never)}
              >
                <option value="30d">30 jours (quick wins)</option>
                <option value="90d">90 jours (trimestre)</option>
                <option value="12mo">12 mois (annuelle)</option>
              </select>
            </div>
            <div>
              <Label>Contexte additionnel (optionnel)</Label>
              <Textarea
                rows={2}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="Ex: lancement nouveau produit en avril, budget de 5k€..."
              />
            </div>
          </div>
          <Button onClick={generate} variant="brand" disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? 'Génération en cours (30-90s)…' : 'Générer la stratégie complète'}
          </Button>
        </CardContent>
      </Card>

      {/* ===== TABS — existing strategies ===== */}
      {strategies.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b">
          {strategies.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveStrategyId(s.id)}
              className={cn(
                'border-b-2 px-3 py-2 text-xs transition-colors',
                activeStrategyId === s.id
                  ? 'border-brand-600 text-brand-700 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              {s.title.slice(0, 40)}
              <Badge variant={s.status === 'VALIDATED' ? 'success' : s.status === 'IN_EXECUTION' ? 'info' : 'secondary'} className="ml-1 text-[9px]">
                {s.status}
              </Badge>
            </button>
          ))}
        </div>
      ) : null}

      {/* ===== ACTIVE STRATEGY ===== */}
      {active ? (
        <div className="space-y-4">
          {/* === STICKY ACTION BANNER === */}
          {active.status === 'DRAFT' ? (
            <Card className="sticky top-0 z-10 border-violet-300 bg-gradient-to-r from-violet-100 to-fuchsia-100 shadow-md">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-violet-900">Étape 1 — Valider la stratégie</div>
                    <div className="text-xs text-violet-800">
                      Cliques pour confirmer ce plan, puis approuves chaque item ci-dessous individuellement.
                    </div>
                  </div>
                </div>
                <Button variant="brand" size="lg" onClick={() => validateStrategy(active.id)} disabled={busy === active.id}>
                  {busy === active.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Valider la stratégie
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Strategy summary */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>{active.title}</CardTitle>
                <CardDescription>
                  Horizon: {active.horizon ?? '?'} · Modèle: {active.generatedByModel} · Créée {new Date(active.createdAt).toLocaleDateString('fr-FR')}
                  {active.validatedAt ? ` · ✓ Validée le ${new Date(active.validatedAt).toLocaleDateString('fr-FR')} par ${active.validatedBy ?? '?'}` : ''}
                </CardDescription>
              </div>
              <Badge variant={active.status === 'VALIDATED' ? 'success' : 'secondary'} className="text-sm">
                {active.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <StrategyContent strategy={active.strategy} />
            </CardContent>
          </Card>

          {/* Items list */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base">Plan d'action — {active.items.length} items</CardTitle>
                <CardDescription>
                  {active.status === 'DRAFT'
                    ? '⚠️ Valide la stratégie en haut pour activer l\'approbation. Tu peux tout de même prévisualiser.'
                    : 'Approuve item par item, puis transforme en publications/campagnes réelles.'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {active.items.filter((i) => i.status === 'APPROVED').length} approuvés ·{' '}
                  {active.items.filter((i) => i.status === 'EXECUTED').length} exécutés
                </Badge>
                <Button
                  variant="brand"
                  size="sm"
                  onClick={executeAllApproved}
                  disabled={
                    busy === 'execute-all' ||
                    active.status !== 'VALIDATED' ||
                    active.items.filter((i) => i.status === 'APPROVED').length === 0
                  }
                  title={
                    active.status !== 'VALIDATED'
                      ? 'Valide d\'abord la stratégie en haut'
                      : active.items.filter((i) => i.status === 'APPROVED').length === 0
                      ? 'Approuve d\'abord des items'
                      : 'Créer les brouillons en batch'
                  }
                >
                  <Rocket className="mr-1 h-3 w-3" />
                  Exécuter tout ce qui est approuvé
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {active.items.map((item) => {
                const Icon = KIND_ICONS[item.kind] ?? FileText;
                const colorClasses = KIND_COLORS[item.kind] ?? 'text-slate-600 bg-slate-100';
                const isExpanded = expanded.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-lg border transition-colors',
                      item.status === 'APPROVED' && 'border-emerald-300 bg-emerald-50/30',
                      item.status === 'REJECTED' && 'border-rose-300 bg-rose-50/30 opacity-60',
                      item.status === 'EXECUTED' && 'border-brand-300 bg-brand-50/30',
                    )}
                  >
                    <div className="flex items-start gap-3 p-3">
                      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', colorClasses)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{item.kind.replace('_IDEA', '').replace('_', ' ')}</Badge>
                          {item.platform ? <Badge variant="secondary" className="text-[10px]">{item.platform}</Badge> : null}
                          {item.format ? <span className="text-[10px] text-muted-foreground">{item.format}</span> : null}
                          {item.suggestedDate ? <span className="text-[10px] text-muted-foreground">📅 {new Date(item.suggestedDate).toLocaleDateString('fr-FR')}</span> : null}
                        </div>
                        <div className="mt-0.5 font-medium text-sm">{item.title}</div>
                        <p className={cn('mt-1 text-xs text-muted-foreground', !isExpanded && 'line-clamp-2')}>
                          {item.description}
                        </p>
                        {isExpanded ? (
                          <div className="mt-2 space-y-1 text-xs">
                            {item.hashtags.length > 0 ? (
                              <div className="text-muted-foreground">Hashtags: {item.hashtags.join(' ')}</div>
                            ) : null}
                            {item.cta ? <div className="text-muted-foreground">CTA: {item.cta}</div> : null}
                            {item.postId ? <a href={`/posts/${item.postId}`} className="text-brand-600 hover:underline">→ Voir le brouillon</a> : null}
                            {item.campaignId ? <a href={`/campaigns/${item.campaignId}`} className="text-brand-600 hover:underline">→ Voir la campagne</a> : null}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          className="mt-1 text-[10px] text-muted-foreground hover:text-slate-900"
                        >
                          {isExpanded ? <ChevronDown className="inline h-3 w-3" /> : <ChevronRight className="inline h-3 w-3" />}
                          {isExpanded ? ' Réduire' : ' Détails'}
                        </button>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={
                          item.status === 'EXECUTED' ? 'success' :
                          item.status === 'APPROVED' ? 'info' :
                          item.status === 'REJECTED' ? 'destructive' : 'secondary'
                        } className="text-[9px]">
                          {item.status}
                        </Badge>
                        {item.status === 'PROPOSED' ? (
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => itemAction(item.id, 'approve')}
                              disabled={busy === item.id || active.status === 'DRAFT'}
                              title={active.status === 'DRAFT' ? 'Valide la stratégie en haut d\'abord' : 'Approuver'}
                              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            >
                              <Check className="h-3 w-3 mr-1" /> OK
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => itemAction(item.id, 'reject')}
                              disabled={busy === item.id || active.status === 'DRAFT'}
                              title={active.status === 'DRAFT' ? 'Valide la stratégie en haut d\'abord' : 'Rejeter'}
                              className="border-rose-300 text-rose-700 hover:bg-rose-50"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : null}
                        {item.status === 'APPROVED' ? (
                          <Button variant="brand" size="sm" onClick={() => itemAction(item.id, 'execute')} disabled={busy === item.id}>
                            <Rocket className="mr-1 h-3 w-3" />
                            Créer
                          </Button>
                        ) : null}
                        {(item.status === 'REJECTED' || item.status === 'APPROVED') ? (
                          <Button variant="ghost" size="sm" onClick={() => itemAction(item.id, 'reset')} disabled={busy === item.id} title="Réinitialiser">
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      ) : strategies.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 h-10 w-10 text-violet-300" />
            Pas encore de stratégie. Génère ta première ci-dessus pour avoir un plan d'action complet.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// =====================================================================
// STRATEGY CONTENT RENDERER
// =====================================================================
function StrategyContent({ strategy }: { strategy: Record<string, unknown> }) {
  const s = strategy as {
    executive_summary?: string;
    current_situation?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
    target_audience?: { primary: string; secondary?: string; personas?: Array<{ name: string; description: string }> };
    positioning?: { unique_value: string; differentiation: string[]; brand_promise: string };
    objectives?: Array<{ horizon: string; kpi: string; target: string; rationale: string }>;
    content_pillars?: Array<{ name: string; description: string; weight_pct: number; examples: string[] }>;
    channels?: Array<{ platform: string; role: string; frequency: string; format_focus: string[] }>;
    campaigns?: Array<{ name: string; period: string; objective: string; channels: string[]; key_message: string }>;
    experiments?: string[];
    risks_mitigation?: Array<{ risk: string; mitigation: string }>;
    budget_split?: Record<string, string>;
  };

  return (
    <div className="space-y-4">
      {s.executive_summary ? (
        <Section icon={Lightbulb} title="Résumé exécutif">
          <p className="leading-relaxed">{s.executive_summary}</p>
        </Section>
      ) : null}

      {s.current_situation ? (
        <Section icon={Target} title="Analyse SWOT">
          <div className="grid gap-2 md:grid-cols-2">
            <SWOTBox title="Forces" items={s.current_situation.strengths} color="emerald" />
            <SWOTBox title="Faiblesses" items={s.current_situation.weaknesses} color="rose" />
            <SWOTBox title="Opportunités" items={s.current_situation.opportunities} color="sky" />
            <SWOTBox title="Menaces" items={s.current_situation.threats} color="amber" />
          </div>
        </Section>
      ) : null}

      {s.target_audience ? (
        <Section icon={Users} title="Audience cible">
          <p><strong>Primaire:</strong> {s.target_audience.primary}</p>
          {s.target_audience.secondary ? <p><strong>Secondaire:</strong> {s.target_audience.secondary}</p> : null}
          {s.target_audience.personas?.map((p) => (
            <div key={p.name} className="mt-1 rounded border bg-slate-50 p-2 text-xs">
              <strong>{p.name}:</strong> {p.description}
            </div>
          ))}
        </Section>
      ) : null}

      {s.positioning ? (
        <Section icon={Star} title="Positionnement">
          <p><strong>Proposition unique:</strong> {s.positioning.unique_value}</p>
          <p><strong>Promesse:</strong> {s.positioning.brand_promise}</p>
          <p><strong>Différenciation:</strong> {s.positioning.differentiation?.join(' · ')}</p>
        </Section>
      ) : null}

      {s.objectives?.length ? (
        <Section icon={TrendingUp} title="Objectifs mesurables">
          <ul className="space-y-1">
            {s.objectives.map((o, i) => (
              <li key={i} className="rounded border p-2">
                <Badge variant="secondary" className="mr-2 text-[10px]">{o.horizon}</Badge>
                <strong>{o.kpi}</strong>: cible <span className="text-brand-600">{o.target}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{o.rationale}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.content_pillars?.length ? (
        <Section icon={FileText} title="Piliers de contenu">
          <div className="grid gap-2 md:grid-cols-2">
            {s.content_pillars.map((p, i) => (
              <div key={i} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <strong>{p.name}</strong>
                  <Badge variant="secondary" className="text-[10px]">{p.weight_pct}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {s.channels?.length ? (
        <Section icon={Megaphone} title="Mix canaux">
          <ul className="space-y-1">
            {s.channels.map((c, i) => (
              <li key={i} className="rounded border p-2 text-xs">
                <strong>{c.platform}</strong> — {c.role} · {c.frequency} · focus {c.format_focus?.join(', ')}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.campaigns?.length ? (
        <Section icon={Calendar} title="Campagnes prévues">
          <ul className="space-y-1">
            {s.campaigns.map((c, i) => (
              <li key={i} className="rounded border p-2 text-xs">
                <Badge variant="info" className="mr-2 text-[10px]">{c.period}</Badge>
                <strong>{c.name}</strong> — {c.objective}
                <p className="mt-0.5 text-muted-foreground">{c.key_message}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.risks_mitigation?.length ? (
        <Section icon={AlertTriangle} title="Risques et mitigations">
          <ul className="space-y-1 text-xs">
            {s.risks_mitigation.map((r, i) => (
              <li key={i} className="rounded border border-amber-200 bg-amber-50 p-2">
                <strong className="text-amber-900">⚠️ {r.risk}</strong>
                <p className="text-amber-800">→ {r.mitigation}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.budget_split && Object.keys(s.budget_split).length > 0 ? (
        <Section icon={Star} title="Répartition budget suggérée">
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(s.budget_split).map(([k, v]) => (
              <Badge key={k} variant="outline">{k}: {v as string}</Badge>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-slate-50/50 p-3">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
        <Icon className="h-3 w-3" />
        {title}
      </h3>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function SWOTBox({ title, items, color }: { title: string; items: string[]; color: 'emerald' | 'rose' | 'sky' | 'amber' }) {
  const colors = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  return (
    <div className={cn('rounded-lg border p-2', colors[color])}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1">{title}</div>
      <ul className="space-y-0.5 text-xs">
        {items?.map((it, i) => <li key={i}>· {it}</li>)}
      </ul>
    </div>
  );
}
