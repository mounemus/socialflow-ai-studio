'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, Check, X, RefreshCw, Rocket, FileText, Calendar, Target,
  Lightbulb, Users, TrendingUp, Megaphone, Mail, Video, GitBranch, Star, AlertTriangle,
  ChevronDown, ChevronRight, Pencil, Trash2, Save, Paperclip, Archive,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  VALIDATED: 'Validée',
  IN_EXECUTION: 'En exécution',
  ARCHIVED: 'Archivée',
};

interface DocPayload { filename: string; text?: string; docxBase64?: string }

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
  const [title, setTitle] = useState('');
  const [docs, setDocs] = useState<DocPayload[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [activeStrategyId, setActiveStrategyId] = useState<string | null>(existingStrategies[0]?.id ?? null);
  const [strategies, setStrategies] = useState<Strategy[]>(existingStrategies);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const active = strategies.find((s) => s.id === activeStrategyId);
  const archivedCount = strategies.filter((s) => s.status === 'ARCHIVED').length;
  const visibleStrategies = showArchived ? strategies : strategies.filter((s) => s.status !== 'ARCHIVED');

  async function onFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList).slice(0, 3 - docs.length);
    if (Array.from(fileList).length > files.length) toast.warning('Maximum 3 documents');
    for (const file of files) {
      try {
        if (file.name.toLowerCase().endsWith('.docx')) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(new Error('read error'));
            r.readAsDataURL(file);
          });
          setDocs((d) => [...d, { filename: file.name, docxBase64: dataUrl.split(',')[1] ?? '' }]);
        } else {
          const text = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result ?? ''));
            r.onerror = () => reject(new Error('read error'));
            r.readAsText(file);
          });
          setDocs((d) => [...d, { filename: file.name, text }]);
        }
      } catch {
        toast.error(`Lecture impossible : ${file.name}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function generate() {
    if (!brand.hasProfile) {
      const proceed = confirm("La marque n'a pas encore de profil détaillé (mission, audience, ton...). La stratégie sera plus générique. Continuer quand même ?");
      if (!proceed) return;
    }
    setGenerating(true);
    const res = await fetch('/api/strategy/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brandId: brand.id,
        horizon,
        additionalContext: extra,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(docs.length > 0 ? { documents: docs } : {}),
      }),
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
    setTitle('');
    setDocs([]);
    router.refresh();
  }

  async function renameStrategy(strategy: Strategy) {
    const newTitle = prompt('Nouveau titre de la stratégie :', strategy.title)?.trim();
    if (!newTitle || newTitle === strategy.title) return;
    setBusy(strategy.id);
    const res = await fetch(`/api/strategy/${strategy.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur lors du renommage');
    setStrategies((s) => s.map((x) => x.id === strategy.id ? { ...x, title: newTitle } : x));
    toast.success('Stratégie renommée');
  }

  async function archiveStrategy(strategy: Strategy) {
    if (!confirm(`Archiver la stratégie « ${strategy.title} » ? Elle restera accessible via « Voir les archivées ».`)) return;
    setBusy(strategy.id);
    const res = await fetch(`/api/strategy/${strategy.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ARCHIVED' }),
    });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur lors de l\'archivage');
    setStrategies((s) => s.map((x) => x.id === strategy.id ? { ...x, status: 'ARCHIVED' } : x));
    if (!showArchived) {
      const next = strategies.find((x) => x.id !== strategy.id && x.status !== 'ARCHIVED');
      setActiveStrategyId(next?.id ?? null);
    }
    toast.success('Stratégie archivée');
  }

  async function deleteStrategy(strategy: Strategy) {
    if (!confirm(`Supprimer DÉFINITIVEMENT la stratégie « ${strategy.title} » ?\n\nTous ses items (${strategy.items.length}) seront supprimés. Cette action est irréversible.`)) return;
    setBusy(strategy.id);
    const res = await fetch(`/api/strategy/${strategy.id}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur lors de la suppression');
    }
    const remaining = strategies.filter((x) => x.id !== strategy.id);
    setStrategies(remaining);
    setActiveStrategyId(remaining.find((x) => showArchived || x.status !== 'ARCHIVED')?.id ?? null);
    toast.success('Stratégie supprimée');
    router.refresh();
  }

  function restartFromStrategy(strategy: Strategy) {
    if (strategy.horizon === '30d' || strategy.horizon === '90d' || strategy.horizon === '12mo') {
      setHorizon(strategy.horizon);
    }
    setExtra(`Nouvelle version de la stratégie « ${strategy.title} » — améliore et renouvelle les idées`);
    setTitle('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => titleInputRef.current?.focus(), 400);
    toast.info('Formulaire pré-rempli — l\'ancienne stratégie est conservée');
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
      if (data.alreadyExecuted) {
        toast.info('Item déjà exécuté');
      } else if (data.postId) {
        // Success message including schedule status
        if (data.scheduleId) {
          toast.success('✓ Brouillon créé + ajouté au calendrier', {
            description: 'Ouverture du Studio IA pour développer le contenu…',
            duration: 5000,
          });
        } else {
          toast.success('✓ Brouillon créé', {
            description: (data.warnings?.[0] ?? 'Ouverture du Studio IA pour développer le contenu…'),
            duration: 6000,
          });
        }
        // Show any warnings
        for (const w of (data.warnings ?? []).slice(1)) toast.warning(w);
      } else if (data.campaignId) {
        toast.success('✓ Campagne créée en brouillon — accessible dans /campaigns');
      } else {
        toast.success('Item exécuté');
      }

      // Update local state
      setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
        ...str,
        items: str.items.map((i) => i.id === itemId ? { ...i, status: 'EXECUTED', postId: data.postId ?? null, campaignId: data.campaignId ?? null } : i),
      }));

      // Redirect to AI Studio for content design assistance
      if (data.nextStep?.url && data.postId) {
        // Wait a moment for the toast to be visible
        setTimeout(() => {
          router.push(data.nextStep.url);
        }, 1500);
      }
    } else {
      const newStatus = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'PROPOSED';
      setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
        ...str,
        items: str.items.map((i) => i.id === itemId ? { ...i, status: newStatus } : i),
      }));
      toast.success(action === 'approve' ? 'Approuvé' : action === 'reject' ? 'Rejeté' : 'Réinitialisé');
    }
  }

  async function updateItem(itemId: string, patch: Partial<Item>) {
    setBusy(itemId);
    const res = await fetch(`/api/strategy/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? 'Erreur');
      return false;
    }
    const { data } = await res.json();
    setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
      ...str,
      items: str.items.map((i) => i.id === itemId ? { ...i, ...data, suggestedDate: data.suggestedDate ?? null } : i),
    }));
    toast.success('Item mis à jour');
    return true;
  }

  async function regenerateItem(itemId: string, extraInstruction?: string) {
    setBusy(itemId);
    const res = await fetch(`/api/strategy/items/${itemId}/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extraInstruction }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? 'Erreur régénération');
      return;
    }
    const { data } = await res.json();
    setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
      ...str,
      items: str.items.map((i) => i.id === itemId ? {
        ...i,
        title: data.item.title,
        description: data.item.description,
        platform: data.item.platform,
        format: data.item.format,
        suggestedDate: data.item.suggestedDate,
        hashtags: data.item.hashtags ?? [],
        cta: data.item.cta,
        status: 'PROPOSED',
      } : i),
    }));
    toast.success(`Item régénéré ${data.mocked ? '(mock)' : ''}`);
  }

  async function deleteItem(itemId: string) {
    if (!confirm('Supprimer définitivement cet item ?')) return;
    setBusy(itemId);
    const res = await fetch(`/api/strategy/items/${itemId}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? 'Erreur');
      return;
    }
    setStrategies((s) => s.map((str) => str.id !== active?.id ? str : {
      ...str,
      items: str.items.filter((i) => i.id !== itemId),
    }));
    toast.success('Item supprimé');
  }

  async function executeAllApproved() {
    if (!active) return;
    const toExec = active.items.filter((i) => i.status === 'APPROVED');
    if (toExec.length === 0) return toast.info('Aucun item approuvé à exécuter');
    if (!confirm(`Créer ${toExec.length} brouillon${toExec.length > 1 ? 's' : ''} ?\n\nLes items avec une date suggérée + plateforme connectée seront aussi planifiés automatiquement dans le calendrier.`)) return;
    setBusy('execute-all');
    let ok = 0;
    let scheduled = 0;
    for (const item of toExec) {
      const res = await fetch(`/api/strategy/items/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'execute' }),
      });
      if (res.ok) {
        ok++;
        const { data } = await res.json();
        if (data.scheduleId) scheduled++;
      }
    }
    setBusy(null);
    toast.success(`${ok}/${toExec.length} items exécutés${scheduled > 0 ? ` · ${scheduled} planifiés` : ''}`, {
      description: scheduled > 0 ? 'Ouvre le calendrier pour voir la planification' : undefined,
      action: ok > 0 ? { label: 'Voir calendrier', onClick: () => router.push('/calendar') } : undefined,
    });
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
      <Card ref={formRef} className="border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50">
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
          <div>
            <Label>Titre de la stratégie (optionnel)</Label>
            <Input
              ref={titleInputRef}
              className="mt-1 bg-white"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Stratégie lancement printemps 2026"
            />
          </div>
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
          <div>
            <Label>Documents à analyser (optionnel)</Label>
            <p className="text-[11px] text-muted-foreground">Brief, étude de marché, plan produit… (.md, .txt, .docx — max 3)</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.docx"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={docs.length >= 3}
              >
                <Paperclip className="mr-1 h-3 w-3" />
                Ajouter un document
              </Button>
              {docs.map((d, i) => (
                <Badge key={`${d.filename}-${i}`} variant="secondary" className="gap-1 bg-white">
                  <FileText className="h-3 w-3" />
                  {d.filename}
                  <button
                    type="button"
                    onClick={() => setDocs((arr) => arr.filter((_, j) => j !== i))}
                    className="ml-0.5 text-muted-foreground hover:text-rose-600"
                    aria-label={`Retirer ${d.filename}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
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
        <div className="flex flex-wrap items-center gap-1 border-b">
          {visibleStrategies.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveStrategyId(s.id)}
              className={cn(
                'border-b-2 px-3 py-2 text-xs transition-colors',
                activeStrategyId === s.id
                  ? 'border-brand-600 text-brand-700 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
                s.status === 'ARCHIVED' && 'opacity-60',
              )}
            >
              {s.title.slice(0, 40)}
              <Badge
                variant={s.status === 'VALIDATED' ? 'success' : s.status === 'IN_EXECUTION' ? 'info' : s.status === 'ARCHIVED' ? 'outline' : 'secondary'}
                className="ml-1 text-[9px]"
              >
                {STATUS_LABELS[s.status] ?? s.status}
              </Badge>
              <span className="ml-1 text-[9px] text-muted-foreground">
                {new Date(s.createdAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}
              </span>
            </button>
          ))}
          {archivedCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                const next = !showArchived;
                setShowArchived(next);
                if (!next && active?.status === 'ARCHIVED') {
                  setActiveStrategyId(strategies.find((x) => x.status !== 'ARCHIVED')?.id ?? null);
                }
              }}
              className="ml-auto px-3 py-2 text-[10px] text-muted-foreground hover:text-slate-900"
            >
              <Archive className="mr-1 inline h-3 w-3" />
              {showArchived ? 'Masquer les archivées' : `Voir les archivées (${archivedCount})`}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ===== ACTIVE STRATEGY ===== */}
      {active ? (
        <div className="space-y-4">
          {/* === WORKFLOW PROGRESS BAR === */}
          <Card className="border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-violet-900">Plan d'action:</span>
                <span className="flex items-center gap-1">
                  <Badge variant="secondary">{active.items.filter((i) => i.status === 'PROPOSED').length}</Badge>
                  <span className="text-xs">proposés</span>
                </span>
                <span className="flex items-center gap-1">
                  <Badge variant="info">{active.items.filter((i) => i.status === 'APPROVED').length}</Badge>
                  <span className="text-xs">approuvés</span>
                </span>
                <span className="flex items-center gap-1">
                  <Badge variant="success">{active.items.filter((i) => i.status === 'EXECUTED').length}</Badge>
                  <span className="text-xs">exécutés</span>
                </span>
                <span className="flex items-center gap-1">
                  <Badge variant="destructive">{active.items.filter((i) => i.status === 'REJECTED').length}</Badge>
                  <span className="text-xs">rejetés</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {active.status === 'DRAFT' ? (
                  <Button variant="outline" size="sm" onClick={() => validateStrategy(active.id)} disabled={busy === active.id}>
                    {busy === active.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                    Valider toute la stratégie
                  </Button>
                ) : (
                  <Badge variant="success">✓ Stratégie validée</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Strategy summary */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>{active.title}</CardTitle>
                <CardDescription>
                  Horizon: {active.horizon ?? '?'} · Modèle: {active.generatedByModel} · Créée {new Date(active.createdAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}
                  {active.validatedAt ? ` · ✓ Validée le ${new Date(active.validatedAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })} par ${active.validatedBy ?? '?'}` : ''}
                </CardDescription>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant={active.status === 'VALIDATED' ? 'success' : active.status === 'ARCHIVED' ? 'outline' : 'secondary'} className="text-sm">
                  {STATUS_LABELS[active.status] ?? active.status}
                </Badge>
                <div className="flex flex-wrap justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => renameStrategy(active)} disabled={busy === active.id} title="Renommer cette stratégie">
                    <Pencil className="mr-1 h-3 w-3" /> Renommer
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => restartFromStrategy(active)} title="Générer une nouvelle version (l'ancienne est conservée)">
                    <RefreshCw className="mr-1 h-3 w-3" /> Recommencer
                  </Button>
                  {active.status !== 'ARCHIVED' ? (
                    <Button variant="ghost" size="sm" onClick={() => archiveStrategy(active)} disabled={busy === active.id} title="Archiver cette stratégie">
                      <Archive className="mr-1 h-3 w-3" /> Archiver
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => deleteStrategy(active)} disabled={busy === active.id} title="Supprimer définitivement">
                    <Trash2 className="mr-1 h-3 w-3" /> Supprimer
                  </Button>
                </div>
              </div>
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
                  Approuve, édite, régénère ou rejette chaque item indépendamment. Crée le brouillon réel quand prêt.
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
                    active.items.filter((i) => i.status === 'APPROVED').length === 0
                  }
                  title={
                    active.items.filter((i) => i.status === 'APPROVED').length === 0
                      ? 'Approuve d\'abord des items'
                      : 'Créer les brouillons en batch pour tous les items approuvés'
                  }
                >
                  <Rocket className="mr-1 h-3 w-3" />
                  Exécuter tout ce qui est approuvé
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {active.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  busy={busy === item.id}
                  expanded={expanded.has(item.id)}
                  onToggleExpand={() => toggleExpand(item.id)}
                  onAction={(action) => itemAction(item.id, action)}
                  onUpdate={(patch) => updateItem(item.id, patch as never)}
                  onRegenerate={(instruction) => regenerateItem(item.id, instruction)}
                  onDelete={() => deleteItem(item.id)}
                />
              ))}
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
// ITEM CARD — editable + regeneratable + approve/reject
// =====================================================================
const PLATFORMS = ['', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'];
const FORMATS = ['', 'INSTAGRAM_POST', 'INSTAGRAM_STORY', 'INSTAGRAM_REEL', 'INSTAGRAM_CAROUSEL', 'FACEBOOK_POST', 'LINKEDIN_POST', 'LINKEDIN_ARTICLE', 'TWITTER_POST', 'TWITTER_THREAD', 'TIKTOK_VIDEO', 'YOUTUBE_SHORT', 'PINTEREST_PIN', 'EMAIL_MARKETING', 'AD_VISUAL', 'VIDEO_SCRIPT'];

function ItemCard({
  item, busy, expanded, onToggleExpand, onAction, onUpdate, onRegenerate, onDelete,
}: {
  item: Item;
  busy: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onAction: (action: 'approve' | 'reject' | 'reset' | 'execute') => void;
  onUpdate: (patch: Partial<Item>) => Promise<boolean>;
  onRegenerate: (instruction?: string) => void;
  onDelete: () => void;
}) {
  const Icon = KIND_ICONS[item.kind] ?? FileText;
  const colorClasses = KIND_COLORS[item.kind] ?? 'text-slate-600 bg-slate-100';
  const [editing, setEditing] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [editForm, setEditForm] = useState({
    title: item.title,
    description: item.description,
    platform: item.platform ?? '',
    format: item.format ?? '',
    suggestedDate: item.suggestedDate ? item.suggestedDate.slice(0, 10) : '',
    hashtags: item.hashtags.join(' '),
    cta: item.cta ?? '',
  });

  async function saveEdit() {
    const ok = await onUpdate({
      title: editForm.title,
      description: editForm.description,
      platform: editForm.platform || null,
      format: editForm.format || null,
      suggestedDate: editForm.suggestedDate ? new Date(editForm.suggestedDate).toISOString() : null,
      hashtags: editForm.hashtags.split(/\s+/).filter(Boolean),
      cta: editForm.cta || null,
    } as never);
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg border-2 border-brand-400 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-full', colorClasses)}>
              <Icon className="h-3 w-3" />
            </div>
            <Badge variant="info" className="text-[10px]">Édition</Badge>
            <span className="text-[10px] text-muted-foreground">{item.kind}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="brand" onClick={saveEdit} disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Enregistrer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </div>
        </div>
        <div className="space-y-2 text-xs">
          <div>
            <Label className="text-[10px]">Titre</Label>
            <Input className="h-8 text-xs" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          </div>
          <div>
            <Label className="text-[10px]">Description</Label>
            <Textarea rows={3} className="text-xs" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Plateforme</Label>
              <select className="h-8 w-full rounded-md border px-2 text-xs" value={editForm.platform} onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Format</Label>
              <select className="h-8 w-full rounded-md border px-2 text-xs" value={editForm.format} onChange={(e) => setEditForm({ ...editForm, format: e.target.value })}>
                {FORMATS.map((f) => <option key={f} value={f}>{f || '—'}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Date suggérée</Label>
              <Input type="date" className="h-8 text-xs" value={editForm.suggestedDate} onChange={(e) => setEditForm({ ...editForm, suggestedDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-[10px]">CTA</Label>
              <Input className="h-8 text-xs" value={editForm.cta} onChange={(e) => setEditForm({ ...editForm, cta: e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-[10px]">Hashtags (séparés par espace)</Label>
            <Input className="h-8 text-xs" value={editForm.hashtags} onChange={(e) => setEditForm({ ...editForm, hashtags: e.target.value })} placeholder="#tag1 #tag2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{item.kind.replace('_IDEA', '').replace('_', ' ')}</Badge>
            {item.platform ? <Badge variant="secondary" className="text-[10px]">{item.platform}</Badge> : null}
            {item.format ? <span className="text-[10px] text-muted-foreground">{item.format}</span> : null}
            {item.suggestedDate ? <span className="text-[10px] text-muted-foreground">📅 {new Date(item.suggestedDate).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}</span> : null}
          </div>
          <div className="mt-0.5 font-medium text-sm">{item.title}</div>
          <p className={cn('mt-1 text-xs text-muted-foreground', !expanded && 'line-clamp-2')}>
            {item.description}
          </p>
          {expanded ? (
            <div className="mt-2 space-y-1 text-xs">
              {item.hashtags.length > 0 ? (
                <div className="text-muted-foreground">Hashtags: {item.hashtags.join(' ')}</div>
              ) : null}
              {item.cta ? <div className="text-muted-foreground">CTA: {item.cta}</div> : null}
              {item.postId ? <a href={`/posts/${item.postId}`} className="text-brand-600 hover:underline">→ Voir le brouillon</a> : null}
              {item.campaignId ? <a href={`/campaigns/${item.campaignId}`} className="text-brand-600 hover:underline">→ Voir la campagne</a> : null}
            </div>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-[10px] text-muted-foreground hover:text-slate-900"
            >
              {expanded ? <ChevronDown className="inline h-3 w-3" /> : <ChevronRight className="inline h-3 w-3" />}
              {expanded ? ' Réduire' : ' Détails'}
            </button>
            {item.status !== 'EXECUTED' ? (
              <>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={() => setEditing(true)} className="text-[10px] text-brand-600 hover:underline">
                  <Pencil className="inline h-3 w-3 mr-0.5" /> Éditer
                </button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={() => setShowRegen((v) => !v)} className="text-[10px] text-violet-600 hover:underline">
                  <Sparkles className="inline h-3 w-3 mr-0.5" /> Régénérer
                </button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={onDelete} className="text-[10px] text-rose-600 hover:underline" disabled={busy}>
                  <Trash2 className="inline h-3 w-3 mr-0.5" /> Supprimer
                </button>
              </>
            ) : null}
          </div>
          {showRegen ? (
            <div className="mt-2 flex gap-2 rounded border border-violet-200 bg-violet-50 p-2">
              <Input
                placeholder="Instruction spécifique (optionnel): ex 'plus orienté B2B'"
                value={regenInstruction}
                onChange={(e) => setRegenInstruction(e.target.value)}
                className="h-7 text-xs"
              />
              <Button size="sm" variant="brand" onClick={() => { onRegenerate(regenInstruction || undefined); setShowRegen(false); setRegenInstruction(''); }} disabled={busy}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Régénérer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowRegen(false)}>Annuler</Button>
            </div>
          ) : null}
        </div>

        {/* === ACTIONS COLUMN === */}
        <div className="flex flex-col items-end gap-1.5">
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
                onClick={() => onAction('approve')}
                disabled={busy}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                <Check className="h-3 w-3 mr-1" /> OK
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('reject')}
                disabled={busy}
                className="border-rose-300 text-rose-700 hover:bg-rose-50"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : null}
          {item.status === 'APPROVED' ? (
            <Button variant="brand" size="sm" onClick={() => onAction('execute')} disabled={busy}>
              <Rocket className="mr-1 h-3 w-3" />
              Créer
            </Button>
          ) : null}
          {(item.status === 'REJECTED' || item.status === 'APPROVED') ? (
            <Button variant="ghost" size="sm" onClick={() => onAction('reset')} disabled={busy} title="Réinitialiser">
              <RefreshCw className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </div>
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
