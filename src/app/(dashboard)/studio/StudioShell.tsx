'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TextStudio } from '../ai-studio/TextStudio';
import { ImageStudio } from '../ai-studio/ImageStudio';
import {
  ClipboardList, Type, Image as ImageIcon, Palette, Eye, CheckCircle2, Send, ExternalLink,
} from 'lucide-react';

type TabId = 'brief' | 'texte' | 'visuel' | 'canva' | 'apercu' | 'validation' | 'diffusion';

const TABS: { id: TabId; label: string; icon: typeof Type }[] = [
  { id: 'brief', label: 'Brief', icon: ClipboardList },
  { id: 'texte', label: 'Texte', icon: Type },
  { id: 'visuel', label: 'Visuel', icon: ImageIcon },
  { id: 'canva', label: 'Canva', icon: Palette },
  { id: 'apercu', label: 'Aperçu', icon: Eye },
  { id: 'validation', label: 'Validation', icon: CheckCircle2 },
  { id: 'diffusion', label: 'Diffusion', icon: Send },
];

interface Brand {
  id: string;
  name: string;
  profile?: { toneOfVoice?: string | null; audienceTarget?: string | null; visualStyle?: string | null } | null;
}
interface PostRow {
  id: string;
  title: string | null;
  body: string | null;
  hashtags: string[];
  status: string;
  format: string;
  brand?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
}
interface AccountRow {
  id: string;
  platform: string;
  handle: string;
  status: string;
  _count?: { tokens: number };
}
interface ProviderEntry {
  id: string;
  label: string;
  available: boolean;
  mode: 'REAL' | 'SIMULATED' | 'UNAVAILABLE';
  reliabilityScore: number | null;
  observed: { requests7d: number; successRate: number | null; p50LatencyMs: number | null };
  estCostPerCallUsd: number | null;
}

const PROVIDER_MODE_BADGE: Record<ProviderEntry['mode'], 'success' | 'warning' | 'secondary'> = {
  REAL: 'success',
  SIMULATED: 'warning',
  UNAVAILABLE: 'secondary',
};

export function StudioShell() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<TabId>('brief');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState(sp.get('brandId') ?? '');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postId, setPostId] = useState(sp.get('postId') ?? '');
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [platform, setPlatform] = useState(sp.get('platform') ?? 'INSTAGRAM');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  // Canva
  const [canvaBrief, setCanvaBrief] = useState('');
  const [canvaLoading, setCanvaLoading] = useState(false);
  // Validation / diffusion
  const [approvalMessage, setApprovalMessage] = useState('');
  const [scheduleAccountId, setScheduleAccountId] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    const [b, p, a, pr] = await Promise.all([
      fetch('/api/brands').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/posts').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/social/accounts').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/ai/providers').then((r) => (r.ok ? r.json() : null)),
    ]);
    if (b?.data) setBrands(b.data as Brand[]);
    if (p?.data) setPosts(p.data as PostRow[]);
    if (a?.data) setAccounts(a.data as AccountRow[]);
    if (pr?.data?.providers) setProviders(pr.data.providers as ProviderEntry[]);
  }, []);
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const brand = useMemo(() => brands.find((b) => b.id === brandId) ?? null, [brands, brandId]);
  const post = useMemo(() => posts.find((p) => p.id === postId) ?? null, [posts, postId]);
  const brandPosts = useMemo(
    () => (brandId ? posts.filter((p) => p.brand?.id === brandId) : posts),
    [posts, brandId],
  );

  async function generateCanvaBrief() {
    if (!brandId) return toast.error('Choisis d’abord une marque dans l’onglet Brief.');
    setCanvaLoading(true);
    try {
      const res = await fetch('/api/ai/generate-brief-canva', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId,
          topic: objective || post?.title || 'Publication sociale',
          format: `${platform}_POST`,
          audience: audience || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Erreur');
      setCanvaBrief(json.data?.brief ?? json.data ?? '');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCanvaLoading(false);
    }
  }

  async function requestApproval() {
    if (!postId) return toast.error('Sélectionne d’abord une publication.');
    setBusy(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, message: approvalMessage || undefined }),
      });
      if (!res.ok) throw new Error('Demande de validation impossible');
      toast.success('Validation demandée — visible dans Créer → Validations.');
      loadAll();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function schedulePost() {
    if (!postId) return toast.error('Sélectionne d’abord une publication.');
    if (!scheduleAccountId || !scheduleAt) return toast.error('Compte et date requis.');
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          socialAccountId: scheduleAccountId,
          scheduledFor: new Date(scheduleAt).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Programmation impossible');
      toast.success('Publication programmée. Statut visible dans le calendrier (réel ou SIMULATED selon la configuration).');
      loadAll();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Atelier créatif</h1>
          <p className="text-sm text-muted-foreground">
            Brief → Texte → Visuel → Canva → Aperçu → Validation → Diffusion, avec le contexte de la marque.
          </p>
        </div>
        {brand ? <Badge variant="secondary">Marque : {brand.name}</Badge> : null}
      </div>

      {/* Onglets */}
      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'brief' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contexte de création</CardTitle>
              <CardDescription>
                Ce contexte est repris par les onglets Texte, Visuel et Canva.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs font-medium">Marque</label>
                <select className={selectClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  <option value="">— Choisir une marque —</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Plateforme cible</label>
                <select className={selectClass} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TIKTOK', 'TWITTER', 'YOUTUBE', 'PINTEREST'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Objectif</label>
                <input className={selectClass} placeholder="Ex: faire connaître la nouvelle collection" value={objective} onChange={(e) => setObjective(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium">Audience</label>
                <input className={selectClass} placeholder="Ex: jeunes créateurs 18-30, francophones" value={audience} onChange={(e) => setAudience(e.target.value)} />
              </div>
              {brand?.profile ? (
                <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                  <div className="font-medium text-slate-800">Brand DNA injecté</div>
                  {brand.profile.toneOfVoice ? <div>Ton : {brand.profile.toneOfVoice}</div> : null}
                  {brand.profile.audienceTarget ? <div>Audience : {brand.profile.audienceTarget}</div> : null}
                  {brand.profile.visualStyle ? <div>Style visuel : {brand.profile.visualStyle}</div> : null}
                  {!brand.profile.toneOfVoice && !brand.profile.audienceTarget ? (
                    <div>
                      Profil incomplet — <Link className="text-brand-600 hover:underline" href={`/brands/${brand.id}`}>compléter le Brand DNA →</Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fournisseurs IA — capacités réelles</CardTitle>
              <CardDescription>
                Disponibilité, fiabilité observée (7 j) et coût estimé. Un fournisseur « simulation » ne
                produit pas de contenu réel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {providers.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.label}</span>
                      <Badge variant={PROVIDER_MODE_BADGE[p.mode]}>
                        {p.mode === 'REAL' ? 'réel' : p.mode === 'SIMULATED' ? 'simulation' : 'indisponible'}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {p.observed.requests7d > 0 ? (
                        <>
                          {Math.round((p.observed.successRate ?? 0) * 100)}% succès · p50{' '}
                          {p.observed.p50LatencyMs}ms
                        </>
                      ) : (
                        'pas encore de données'
                      )}
                      {p.estCostPerCallUsd != null ? ` · ~$${p.estCostPerCallUsd}/appel` : ''}
                    </div>
                  </div>
                ))}
                {providers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Chargement du registre…</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'texte' ? <TextStudio /> : null}
      {tab === 'visuel' ? <ImageStudio /> : null}

      {tab === 'canva' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brief Canva contextualisé</CardTitle>
              <CardDescription>
                Génère un brief prêt à coller dans Canva à partir du contexte du Brief.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button size="sm" variant="brand" onClick={generateCanvaBrief} disabled={canvaLoading}>
                {canvaLoading ? 'Génération…' : 'Générer le brief'}
              </Button>
              {canvaBrief ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-slate-50 p-2 text-xs">{canvaBrief}</pre>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modes Canva</CardTitle>
              <CardDescription>
                Le mode réellement utilisé est toujours affiché : API (création réelle), HANDOFF
                (ouverture dans Canva puis retour), ou fallback manuel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link href="/canva-studio">
                <Button variant="outline" size="sm">
                  Ouvrir Canva Studio <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </Link>
              <p className="text-xs text-muted-foreground">
                La création automatique depuis un Brand Template (mode API) nécessite les scopes
                enterprise Canva + un brand_template_id — statut visible dans Connexions.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {(tab === 'apercu' || tab === 'validation' || tab === 'diffusion') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publication de travail</CardTitle>
          </CardHeader>
          <CardContent>
            <select className={selectClass} value={postId} onChange={(e) => setPostId(e.target.value)}>
              <option value="">— Choisir une publication —</option>
              {brandPosts.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.status}] {p.title ?? p.body?.slice(0, 60) ?? p.format}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {tab === 'apercu' && post ? (
        <div className="grid gap-4 md:grid-cols-3">
          {(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN'] as const).map((pf) => (
            <Card key={pf}>
              <CardHeader>
                <CardTitle className="text-sm">{pf}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn('rounded-lg border bg-white p-3', pf === 'INSTAGRAM' ? 'aspect-square overflow-hidden' : '')}>
                  {typeof post.metadata?.coverUrl === 'string' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.metadata.coverUrl as string} alt="visuel" className="mb-2 max-h-40 w-full rounded object-cover" />
                  ) : (
                    <div className="mb-2 flex h-24 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">
                      Pas de visuel attaché
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-xs">
                    {(post.body ?? '').slice(0, pf === 'LINKEDIN' ? 700 : 300)}
                    {(post.body ?? '').length > 300 ? '…' : ''}
                  </p>
                  <p className="mt-1 text-xs text-sky-600">{post.hashtags.slice(0, 6).join(' ')}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === 'validation' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Demander une validation</CardTitle>
            <CardDescription>
              La publication passe en PENDING_APPROVAL et apparaît dans Créer → Validations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              className={selectClass}
              rows={2}
              placeholder="Message pour le relecteur (optionnel)"
              value={approvalMessage}
              onChange={(e) => setApprovalMessage(e.target.value)}
            />
            <Button size="sm" variant="brand" onClick={requestApproval} disabled={busy || !postId}>
              Demander la validation
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'diffusion' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Programmer la diffusion</CardTitle>
            <CardDescription>
              Le statut final sera PUBLISHED uniquement si le réseau confirme (sinon SIMULATED,
              FAILED ou ACTION_REQUIRED — jamais de faux succès).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <label className="text-xs font-medium">Compte social</label>
              <select className={selectClass} value={scheduleAccountId} onChange={(e) => setScheduleAccountId(e.target.value)}>
                <option value="">— Choisir un compte —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} · @{a.handle} ({a.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Date et heure</label>
              <input type="datetime-local" className={selectClass} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="brand" onClick={schedulePost} disabled={busy || !postId}>
                Programmer
              </Button>
              {postId ? (
                <Link href={`/posts/${postId}`}>
                  <Button size="sm" variant="outline">Ouvrir la publication</Button>
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
