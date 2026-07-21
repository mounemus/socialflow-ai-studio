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
const TYPES = ['PROFILE', 'PAGE', 'BUSINESS', 'CHANNEL', 'GROUP'];

export default function ConnectAccount() {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    platform: 'INSTAGRAM',
    type: 'BUSINESS',
    externalId: '',
    handle: '',
    displayName: '',
    brandId: '',
  });

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => setBrands(d.data ?? []));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/social/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
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
    try {
      const res = await fetch('/api/late/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: zernioPlatform }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Zernio non configuré (LATE_API_KEY ?)');
      window.open(json.data.authUrl as string, '_blank', 'noopener');
      toast.info('Autorise le compte dans l’onglet Zernio, puis clique « Synchroniser ».');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setZernioBusy(false);
    }
  }

  async function syncZernioAccounts() {
    setZernioBusy(true);
    try {
      const res = await fetch('/api/late/sync-accounts', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Synchronisation impossible');
      const d = json.data as { mapped: number; created: number; total: number };
      toast.success(`Zernio: ${d.total} compte(s) — ${d.mapped} mappé(s), ${d.created} créé(s).`);
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
              <Label>Type</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>External ID (id plateforme)</Label>
              <Input required value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Handle (@)</Label>
              <Input required value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Nom affiché</Label>
              <Input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Marque associée</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                <option value="">— aucune —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
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
