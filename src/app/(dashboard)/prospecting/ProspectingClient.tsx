'use client';

/**
 * Prospection intelligente — recherche de prospects publics (ScrapeGraphAI)
 * à partir d'une cible + zone, puis sélection pour créer une campagne email
 * (module Diffusion existant, /campaigns/outreach).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { UserSearch, Trash2, Send, Loader2, Sparkles } from 'lucide-react';

type ProspectStatus = 'NEW' | 'QUALIFIED' | 'CONTACTED' | 'REPLIED' | 'DISCARDED';
type Prospect = {
  id: string;
  name: string;
  organizationName: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  status: ProspectStatus;
  notes: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<ProspectStatus, string> = {
  NEW: 'Nouveau', QUALIFIED: 'Qualifié', CONTACTED: 'Contacté', REPLIED: 'A répondu', DISCARDED: 'Écarté',
};
const STATUS_BADGE: Record<ProspectStatus, 'secondary' | 'success' | 'outline' | 'destructive'> = {
  NEW: 'secondary', QUALIFIED: 'success', CONTACTED: 'outline', REPLIED: 'success', DISCARDED: 'destructive',
};

type ProspectSource = 'auto' | 'linkedin' | 'web';

export function ProspectingClient({ providers }: { providers: { web: boolean; linkedin: boolean } }) {
  const configured = providers.web || providers.linkedin;
  const router = useRouter();
  const [items, setItems] = useState<Prospect[]>([]);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [source, setSource] = useState<ProspectSource>('auto');
  const [mission, setMission] = useState('');
  const [assisting, setAssisting] = useState(false);
  // Requête web (FR, types d'organisations) produite par l'IA — invalidée si
  // l'utilisateur modifie la cible à la main.
  const [webQuery, setWebQuery] = useState('');
  const [titles, setTitles] = useState('');
  const [seniority, setSeniority] = useState('');
  const [companySize, setCompanySize] = useState('');
  // Nombre de sites web analysés — 10 crédits ScrapeGraphAI par site
  // (plan gratuit : 50/mois). 3 par défaut pour rester dans le budget.
  const [max, setMax] = useState(3);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/prospects');
      const json = await res.json();
      if (res.ok) setItems(json.data.items ?? []);
    } catch {
      /* liste indisponible — l'UI reste utilisable */
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  /** L'IA transforme la mission/objectif en requête + filtres (Gemini, gratuit). */
  async function assistWithAI() {
    if (!mission.trim()) { toast.error('Décris ta mission ou ton objectif.'); return; }
    setAssisting(true);
    try {
      const res = await fetch('/api/prospects/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mission }),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Génération impossible');
      const d = json.data as { query: string; webQuery: string | null; region: string | null; titles: string[]; seniorities: string[]; companySizes: string[]; rationale: string | null };
      setQuery(d.query);
      setWebQuery(d.webQuery ?? '');
      if (d.region) setRegion(d.region);
      setTitles(d.titles.join(', '));
      setSeniority(d.seniorities[0] ?? '');
      setCompanySize(d.companySizes[0] ?? '');
      toast.success(d.rationale ?? 'Requête générée — vérifie puis lance la recherche.');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setAssisting(false);
    }
  }

  async function runSearch() {
    if (!query.trim()) { toast.error('Décris la cible recherchée.'); return; }
    setSearching(true);
    try {
      const res = await fetch('/api/prospects/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          webQuery: webQuery || undefined,
          region: region || undefined,
          max,
          source,
          titles: titles.split(',').map((t) => t.trim()).filter(Boolean),
          seniorities: seniority ? [seniority] : undefined,
          companySizes: companySize ? [companySize] : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Recherche impossible');
      const { created, duplicates, provider } = json.data as { created: number; duplicates: number; provider?: 'linkedin' | 'web' };
      const via = provider === 'linkedin' ? ' — source LinkedIn (Apollo)' : provider === 'web' ? ' — source Web' : '';
      toast.success(`${created} nouveau${created === 1 ? '' : 'x'} prospect${created === 1 ? '' : 's'} (${duplicates} doublon${duplicates === 1 ? '' : 's'} ignoré${duplicates === 1 ? '' : 's'})${via}`);
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  const [enriching, setEnriching] = useState<string | null>(null);
  async function enrichProspect(id: string) {
    setEnriching(id);
    try {
      const res = await fetch(`/api/prospects/${id}/enrich`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Enrichissement impossible');
      const d = json.data as { found: { email: boolean; phone: boolean; city: boolean }; creditsUsed: number };
      const gains = [d.found.email && 'email', d.found.phone && 'téléphone', d.found.city && 'ville'].filter(Boolean);
      if (gains.length > 0) {
        toast.success(`Trouvé : ${gains.join(', ')}${d.creditsUsed ? ` (${d.creditsUsed} crédits utilisés)` : ' (recherche gratuite)'}`);
      } else {
        toast.info(`Aucune coordonnée publique trouvée${d.creditsUsed ? ` (${d.creditsUsed} crédits utilisés)` : ''} — visite le site manuellement.`);
      }
      await reload();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setEnriching(null);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function updateProspect(id: string, data: { status?: ProspectStatus; notes?: string }) {
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Mise à jour impossible');
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deleteProspect(id: string) {
    try {
      const res = await fetch(`/api/prospects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Suppression impossible');
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function saveNotes(id: string) {
    setEditingNotes(null);
    void updateProspect(id, { notes: notesDraft });
  }

  const selectedWithEmail = items.filter((p) => selected.has(p.id) && p.email);

  async function createCampaign() {
    if (selectedWithEmail.length === 0) return;
    setBusy(true);
    try {
      const date = new Date().toLocaleDateString('fr-CA');
      const emails = [...new Set(selectedWithEmail.map((p) => p.email as string))];
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'EMAIL',
          name: `Prospection — ${date}`,
          subject: 'Une proposition pour vous',
          body: 'Bonjour {{nom}},\n\nNous souhaitions vous présenter notre offre — n\'hésitez pas à nous répondre si cela vous intéresse.\n\nCordialement,',
          emails,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? 'Création impossible');
      await Promise.all(selectedWithEmail.map((p) => updateProspect(p.id, { status: 'QUALIFIED' })));
      setSelected(new Set());
      toast.success('Campagne créée en brouillon — ouverture de l’éditeur…');
      router.push(`/campaigns/outreach?edit=${(json.data as { id: string }).id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Prospection intelligente</h1>
        <p className="text-sm text-muted-foreground">
          Trouve des prospects ciblés (coordonnées publiques) puis lance une campagne email.
        </p>
      </div>

      {!configured && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Aucune source configurée — ajoute au moins une clé sur Vercel puis redéploie :
          APIFY_API_TOKEN (apify.com, leads LinkedIn ~1 $/1000, 5 $ gratuits/mois) et/ou
          SGAI_API_KEY (dashboard.scrapegraphai.com, scraping web).
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nouvelle recherche</CardTitle>
          <CardDescription>Ex. « directions d&apos;écoles primaires et CSS » à « Laval, Québec ».</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border border-brand-200 bg-brand-50/40 p-3">
            <Label htmlFor="p-mission">Mission / objectif — l&apos;IA génère la requête et les filtres</Label>
            <div className="flex flex-col gap-2 md:flex-row">
              <Textarea
                id="p-mission"
                rows={2}
                maxLength={4000}
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                placeholder="Ex: vendre nos ateliers de robotique aux écoles primaires de la Rive-Nord de Montréal d'ici la rentrée"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={() => void assistWithAI()} disabled={assisting} className="md:self-end">
                {assisting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {assisting ? 'Génération…' : 'Générer la requête (IA)'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="p-query">Cible</Label>
              <Input id="p-query" value={query} onChange={(e) => { setQuery(e.target.value); setWebQuery(''); }}
                placeholder="Ex: directions d'écoles primaires" />
            </div>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="p-region">Zone</Label>
              <Input id="p-region" value={region} onChange={(e) => setRegion(e.target.value)}
                placeholder="Ex: Laval, Québec" />
            </div>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="p-source">Source</Label>
              <select
                id="p-source"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={source}
                onChange={(e) => setSource(e.target.value as ProspectSource)}
              >
                <option value="auto">Automatique (recommandé)</option>
                <option value="linkedin" disabled={!providers.linkedin}>
                  LinkedIn — base B2B (Apollo/Apify){providers.linkedin ? '' : ' (clé absente)'}
                </option>
                <option value="web" disabled={!providers.web}>
                  Web — Gemini + ScrapeGraphAI{providers.web ? '' : ' (clé absente)'}
                </option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Automatique : LinkedIn d&apos;abord si configuré, sinon bascule sur le Web.
              </p>
            </div>
            {source !== 'linkedin' && (
              <div className="space-y-2 md:col-span-1">
                <Label htmlFor="p-max">Sites analysés</Label>
                <select
                  id="p-max"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={max}
                  onChange={(e) => setMax(Number(e.target.value))}
                >
                  {[3, 5, 10].map((n) => <option key={n} value={n}>{n} ({n * 10} crédits)</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  10 crédits ScrapeGraphAI par site (source Web seulement). Un site peut livrer plusieurs contacts.
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="p-titles">Titres de poste (filtres, séparés par des virgules)</Label>
              <Input id="p-titles" value={titles} onChange={(e) => setTitles(e.target.value)}
                placeholder="Ex: principal, director of education" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-seniority">Séniorité</Label>
              <select
                id="p-seniority"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
              >
                <option value="">Toutes</option>
                <option value="owner">Propriétaire</option>
                <option value="founder">Fondateur·rice</option>
                <option value="c_suite">Direction générale (C-level)</option>
                <option value="vp">Vice-présidence</option>
                <option value="head">Chef de service</option>
                <option value="director">Direction</option>
                <option value="manager">Gestionnaire</option>
                <option value="senior">Sénior</option>
                <option value="entry">Débutant</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-size">Taille d&apos;organisation</Label>
              <select
                id="p-size"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
              >
                <option value="">Toutes</option>
                <option value="1,10">1–10 employés</option>
                <option value="11,50">11–50 employés</option>
                <option value="51,200">51–200 employés</option>
                <option value="201,500">201–500 employés</option>
                <option value="501,1000">501–1000 employés</option>
                <option value="1001,5000">1000+ employés</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Filtres appliqués nativement à la source LinkedIn ; guident la recherche Web.
              </p>
            </div>
          </div>

          <Button onClick={runSearch} disabled={!configured || searching} variant="brand">
            <UserSearch className="mr-2 h-4 w-4" />
            {searching ? 'Recherche en cours (~30-60 s)…' : 'Rechercher des prospects'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Prospects ({items.length})</CardTitle>
            <CardDescription>{selectedWithEmail.length} sélectionné(s) avec email</CardDescription>
          </div>
          <Button onClick={createCampaign} disabled={busy || selectedWithEmail.length === 0}>
            <Send className="mr-2 h-4 w-4" /> Créer une campagne email ({selectedWithEmail.length} sélectionné{selectedWithEmail.length === 1 ? '' : 's'})
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={<UserSearch className="h-10 w-10" />}
              title="Aucun prospect pour l'instant"
              description="Lance une recherche ci-dessus pour en trouver."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 py-2" />
                    <th className="py-2 pr-2">Nom / Organisation</th>
                    <th className="py-2 pr-2">Email</th>
                    <th className="py-2 pr-2">Ville</th>
                    <th className="py-2 pr-2">Statut</th>
                    <th className="py-2 pr-2">Notes</th>
                    <th className="w-8 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 align-top">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} disabled={!p.email} title={!p.email ? 'Pas d\'email — non sélectionnable' : undefined} />
                      </td>
                      <td className="py-2 pr-2 align-top">
                        <div className="font-medium">{p.name}</div>
                        {p.organizationName ? <div className="text-xs text-muted-foreground">{p.organizationName}{p.role ? ` — ${p.role}` : ''}</div> : null}
                        {p.website ? <a href={p.website.startsWith('http') ? p.website : `https://${p.website}`} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline">{p.website}</a> : null}
                      </td>
                      <td className="py-2 pr-2 align-top">
                        {p.email ?? (
                          <button
                            type="button"
                            onClick={() => void enrichProspect(p.id)}
                            disabled={enriching === p.id}
                            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                            title="Chercher l'email public (Gemini gratuit, puis scraping ciblé 10 crédits si nécessaire)"
                          >
                            {enriching === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            {enriching === p.id ? 'Recherche…' : 'Enrichir'}
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-2 align-top">{p.city ?? '—'}</td>
                      <td className="py-2 pr-2 align-top">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value={p.status}
                          onChange={(e) => void updateProspect(p.id, { status: e.target.value as ProspectStatus })}
                        >
                          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <Badge variant={STATUS_BADGE[p.status]} className="ml-2">{STATUS_LABEL[p.status]}</Badge>
                      </td>
                      <td className="py-2 pr-2 align-top max-w-xs">
                        {editingNotes === p.id ? (
                          <div className="space-y-1">
                            <Textarea rows={2} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} className="text-xs" />
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => saveNotes(p.id)}>Enregistrer</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>Annuler</Button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-left text-xs text-muted-foreground hover:underline"
                            onClick={() => { setEditingNotes(p.id); setNotesDraft(p.notes ?? ''); }}
                          >
                            {p.notes || 'Ajouter une note…'}
                          </button>
                        )}
                      </td>
                      <td className="py-2 align-top">
                        <button type="button" onClick={() => void deleteProspect(p.id)} className="rounded p-1 hover:bg-slate-100" title="Supprimer">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Prospection B2B sur données publiques — respecte la Loi 25 / anti-pourriel (LCAP) : privilégie
        les adresses génériques d&apos;organisation et propose un désabonnement dans tes envois.
      </p>
    </div>
  );
}
