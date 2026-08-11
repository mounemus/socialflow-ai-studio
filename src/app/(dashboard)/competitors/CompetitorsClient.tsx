'use client';

/**
 * Concurrents — ajoutés depuis la Veille (« Suivre ») ou par un simple lien ;
 * l'IA analyse la stratégie de chacun : marketing, prix, messages, publications.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { ReportView } from '@/components/watch/ReportView';
import type { WatchReportContent } from '@/services/watch/IntelligentWatchService';
import { Users, Plus, Sparkles, Loader2, ChevronDown, ChevronUp, LinkIcon, Pencil, Trash2, Radar } from 'lucide-react';

export type SerializedCompetitor = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string | null;
  report: {
    title: string;
    createdAt: string;
    content: WatchReportContent;
    sources: Array<{ uri?: string; title?: string }>;
  } | null;
};

export function CompetitorsClient({ configured, competitors }: {
  configured: boolean;
  competitors: SerializedCompetitor[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [openId, setOpenIdRaw] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', website: '', industry: '', country: '' });
  const [saving, setSaving] = useState(false);
  const [selRecs, setSelRecs] = useState<string[]>([]);
  const [proposing, setProposing] = useState(false);

  function setOpenId(id: string | null) {
    setOpenIdRaw(id);
    setSelRecs([]);
  }

  function toggleRec(rec: string) {
    setSelRecs((prev) => (prev.includes(rec) ? prev.filter((r) => r !== rec) : [...prev, rec]));
  }

  function startEdit(c: SerializedCompetitor) {
    setEditingId(c.id);
    setForm({ name: c.name, website: c.website ?? '', industry: c.industry ?? '', country: c.country ?? '' });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/competitors/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim() || undefined,
          website: form.website.trim() || null,
          industry: form.industry.trim() || null,
          country: form.country.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Modification impossible');
      setEditingId(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeCompetitor(c: SerializedCompetitor) {
    if (!window.confirm(`Supprimer « ${c.name} » et ses rapports d'analyse ?`)) return;
    try {
      const res = await fetch(`/api/competitors/${c.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Suppression impossible');
      toast.success(`${c.name} supprimé.`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  /** Proposition sur mesure depuis les recommandations retenues de l'analyse. */
  async function generateProposal(competitorId: string) {
    if (selRecs.length === 0) return;
    setProposing(true);
    try {
      const res = await fetch('/api/watch/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: selRecs, competitorId }),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Proposition impossible');
      toast.success('Proposition générée — visible dans Veille → Rapports. Tes choix sont mémorisés pour les futures analyses.');
      setSelRecs([]);
    } catch (err) {
      toast.error((err as Error).message.slice(0, 200));
    } finally {
      setProposing(false);
    }
  }

  async function addByUrl() {
    if (!url.trim()) { toast.error('Colle le lien du site du concurrent.'); return; }
    setAdding(true);
    try {
      const res = await fetch('/api/competitors/from-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Ajout impossible');
      const { name } = json.data as { name: string };
      toast.success(`${name} identifié et ajouté — lance son analyse.`);
      setUrl('');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 200));
    } finally {
      setAdding(false);
    }
  }

  async function analyze(id: string) {
    setAnalyzing(id);
    try {
      const res = await fetch(`/api/competitors/${id}/analyze`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Analyse impossible');
      toast.success('Analyse terminée.');
      setOpenId(id);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 200));
    } finally {
      setAnalyzing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Concurrents</h1>
          <p className="text-sm text-muted-foreground">
            Ajoute un concurrent par simple lien — l’IA l’identifie puis analyse sa stratégie : marketing, prix, messages, publications.
          </p>
        </div>
        <Link href="/competitors/new">
          <Button variant="outline" size="sm"><Plus className="mr-2 h-4 w-4" /> Ajout manuel</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Label htmlFor="c-url" className="flex items-center gap-1 text-xs">
            <LinkIcon className="h-3 w-3" /> Ajouter par lien — l’IA identifie l’entreprise
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="c-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://concurrent.com"
              onKeyDown={(e) => { if (e.key === 'Enter') void addByUrl(); }}
            />
            <Button variant="brand" disabled={!configured || adding} onClick={() => void addByUrl()}>
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {adding ? 'Identification…' : 'Ajouter'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {competitors.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="Aucun concurrent suivi"
          description="Colle un lien ci-dessus, ou lance une Veille concurrentielle et clique « Suivre » sur les concurrents découverts."
        />
      ) : (
        <div className="space-y-3">
          {competitors.map((c) => {
            const open = openId === c.id;
            return (
              <Card key={c.id}>
                <CardHeader className="py-3">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left"
                      onClick={() => setOpenId(open ? null : c.id)}
                    >
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <span>{c.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {[c.industry, c.country].filter(Boolean).join(' · ')}
                      </span>
                      {c.website ? (
                        <a
                          href={c.website} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-normal text-brand-600 hover:underline"
                        >
                          {c.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : null}
                    </button>
                    <span className="flex items-center gap-1">
                      {c.report ? (
                        <span className="mr-1 text-xs font-normal text-muted-foreground">
                          analysé le {new Date(c.report.createdAt).toLocaleDateString('fr-CA')}
                        </span>
                      ) : null}
                      <Button
                        size="sm" variant="outline"
                        disabled={!configured || analyzing !== null}
                        onClick={() => void analyze(c.id)}
                      >
                        {analyzing === c.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                        {analyzing === c.id ? 'Analyse (~30 s)…' : c.report ? 'Réanalyser (IA)' : 'Analyser (IA)'}
                      </Button>
                      <button type="button" title="Modifier" onClick={() => startEdit(c)} className="rounded p-1.5 hover:bg-slate-100">
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button type="button" title="Supprimer" onClick={() => void removeCompetitor(c)} className="rounded p-1.5 hover:bg-slate-100">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </span>
                  </CardTitle>
                </CardHeader>
                {editingId === c.id && (
                  <CardContent className="border-t pt-4">
                    <div className="grid gap-2 md:grid-cols-4">
                      <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nom" />
                      <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="Site web" />
                      <Input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} placeholder="Industrie" />
                      <Input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} placeholder="Pays" />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" disabled={saving} onClick={() => void saveEdit(c.id)}>
                        {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Enregistrer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Annuler</Button>
                    </div>
                  </CardContent>
                )}
                {open && editingId !== c.id && (
                  <CardContent className="border-t pt-4">
                    {c.report ? (
                      <>
                        <ReportView
                          content={c.report.content}
                          sources={c.report.sources}
                          selectedRecs={selRecs}
                          onToggleRec={toggleRec}
                        />
                        {selRecs.length > 0 ? (
                          <div className="mt-3 border-t pt-3">
                            <Button size="sm" variant="brand" disabled={proposing} onClick={() => void generateProposal(c.id)}>
                              {proposing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
                              {proposing ? 'Génération…' : `Générer une proposition sur mesure (${selRecs.length} choix)`}
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Pas encore analysé — clique « Analyser (IA) » pour un rapport stratégie / marketing / prix / messages / publications.
                      </p>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
