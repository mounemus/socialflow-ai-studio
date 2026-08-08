'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Brand { id: string; name: string }

const PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'];

/** Type de compte le plus courant par plateforme — évite de le demander. */
const DEFAULT_TYPE: Record<string, string> = {
  FACEBOOK: 'PAGE',
  INSTAGRAM: 'BUSINESS',
  LINKEDIN: 'BUSINESS',
  TWITTER: 'PROFILE',
  TIKTOK: 'PROFILE',
  YOUTUBE: 'CHANNEL',
  PINTEREST: 'PROFILE',
};

export default function ConnectAccount() {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    platform: 'INSTAGRAM',
    handle: '',
    displayName: '',
    brandId: '',
  });

  // `?brandId=` (arrivée depuis la page d'une marque) est prioritaire sur la
  // marque active : on connecte le réseau POUR cette marque précise.
  // `?brandId=` lu depuis l'URL côté client. On évite `useSearchParams` : il
  // impose une frontière Suspense qui empêchait l'hydratation de cette page
  // (les sélecteurs restaient vides, aucun fetch ne partait).
  const [queryBrandId, setQueryBrandId] = useState('');
  useEffect(() => {
    setQueryBrandId(new URLSearchParams(window.location.search).get('brandId') ?? '');
  }, []);
  const [zernioBrandId, setZernioBrandId] = useState('');

  // Chargement des marques — effet dédié, sans condition : la liste doit
  // toujours peupler les sélecteurs, quel que soit le query param.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/brands', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.data)) setBrands(d.data as Brand[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Marque par défaut : `?brandId=` (arrivée depuis une marque) sinon marque active.
  useEffect(() => {
    if (queryBrandId) {
      setZernioBrandId(queryBrandId);
      setForm((f) => ({ ...f, brandId: queryBrandId }));
      return;
    }
    let cancelled = false;
    fetch('/api/me/active-brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const active = d?.data?.activeBrandId as string | null | undefined;
        if (cancelled || !active) return;
        setZernioBrandId((prev) => prev || active);
        setForm((f) => ({ ...f, brandId: f.brandId || active }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [queryBrandId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/social/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // type déduit, externalId généré côté serveur, displayName optionnel.
      body: JSON.stringify({ ...form, type: DEFAULT_TYPE[form.platform] ?? 'PROFILE' }),
    });
    setLoading(false);
    if (!res.ok) {
      toast.error('Connexion impossible');
      return;
    }
    toast.success('Compte enregistré (manuel — sans jeton, publication en partage manuel)');
    router.push('/social-accounts');
  }

  const [zernioPlatform, setZernioPlatform] = useState('TWITTER');
  const [zernioBusy, setZernioBusy] = useState(false);

  async function connectViaZernio() {
    setZernioBusy(true);
    // Onglet ouvert PENDANT le geste utilisateur (avant tout await) — un
    // window.open après le fetch était bloqué par l'anti-popup, et le toast
    // annonçait un succès alors que rien ne s'était ouvert.
    const oauthTab = window.open('about:blank', '_blank');
    try {
      const res = await fetch('/api/late/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: zernioPlatform }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Zernio non configuré (LATE_API_KEY ?)');
      const authUrl = json.data.authUrl as string;
      if (oauthTab && !oauthTab.closed) {
        oauthTab.location.href = authUrl;
        toast.info('Autorise le compte dans l’onglet Zernio, puis clique « Synchroniser ».');
      } else {
        // Popup quand même bloquée : on propose le lien en clair, cliquable.
        toast.info('Popup bloquée — clique ici pour ouvrir Zernio.', {
          duration: 15000,
          action: { label: 'Ouvrir', onClick: () => window.open(authUrl, '_blank', 'noopener') },
        });
      }
    } catch (err) {
      oauthTab?.close();
      toast.error((err as Error).message);
    } finally {
      setZernioBusy(false);
    }
  }

  async function syncZernioAccounts() {
    setZernioBusy(true);
    try {
      const res = await fetch('/api/late/sync-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId: zernioBrandId || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Synchronisation impossible');
      const d = json.data as {
        mapped: number; created: number; total: number;
        skipped?: string[]; warnings?: string[];
      };
      toast.success(`Zernio: ${d.total} compte(s) — ${d.mapped} mappé(s), ${d.created} créé(s).`);
      if (d.skipped?.length) {
        toast.info(`Ignoré(s) — plateforme non gérée : ${d.skipped.join(', ')}`, { duration: 10000 });
      }
      for (const w of d.warnings ?? []) toast.warning(w, { duration: 10000 });
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setZernioBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Connecter via Zernio (recommandé)</CardTitle>
          <CardDescription>
            OAuth réel en deux clics via la passerelle Zernio — couvre X, TikTok, YouTube,
            Pinterest et plus, sans app review individuelle. Nécessite LATE_API_KEY
            (Admin → Connexions → Late / Zernio).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>Plateforme</Label>
            <select
              className="w-44 rounded-md border px-3 py-2 text-sm"
              value={zernioPlatform}
              onChange={(e) => setZernioPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Affecter à la marque</Label>
            <select
              className="w-52 rounded-md border px-3 py-2 text-sm"
              value={zernioBrandId}
              onChange={(e) => setZernioBrandId(e.target.value)}
            >
              <option value="">— Toutes les marques —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <Button type="button" variant="brand" onClick={connectViaZernio} disabled={zernioBusy}>
            {zernioBusy ? '…' : 'Connecter (OAuth Zernio)'}
          </Button>
          <Button type="button" variant="outline" onClick={syncZernioAccounts} disabled={zernioBusy}>
            Synchroniser les comptes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enregistrement manuel</CardTitle>
          <CardDescription>
            Pour tester la chaîne sans OAuth, ou référencer un compte géré ailleurs.
            Un compte manuel sans jeton ni mapping Zernio reste en « partage manuel ».
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Plateforme</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Nom d’utilisateur (@)</Label>
              <Input
                required
                placeholder="ex. mamarque"
                value={form.handle}
                onChange={(e) => setForm({ ...form, handle: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Le pseudo, avec ou sans « @ ». Une URL de profil collée est nettoyée automatiquement.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Nom affiché <span className="text-muted-foreground">(optionnel)</span></Label>
              <Input
                placeholder="Par défaut : le nom d’utilisateur"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Marque associée</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                <option value="">— aucune —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Rattache le compte à une marque. Non rattaché = utilisable par toutes vos marques.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" variant="brand" disabled={loading}>{loading ? '...' : 'Enregistrer'}</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
