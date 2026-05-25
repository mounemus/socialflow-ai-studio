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
    toast.success('Compte enregistré (mock)');
    router.push('/social-accounts');
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Connecter un compte social</CardTitle>
          <CardDescription>
            En mode MVP, on enregistre manuellement un compte pour tester la chaîne complète.
            Le système OAuth réel sera activé une fois les apps Facebook/X/LinkedIn/etc. validées.
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
