'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

export default function NewBrandPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', industry: '', description: '' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? `Création impossible (HTTP ${res.status})`);
      return;
    }
    const { data } = await res.json();
    // Enchaînement « Orbit » : la nouvelle marque devient le contexte global,
    // puis on propose directement de la développer avec l'IA (pipeline
    // pré-rempli, attaché à CETTE marque — pas de doublon).
    await fetch('/api/me/active-brand', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId: data.id }),
    }).catch(() => {});
    toast.success('Marque créée', {
      description: 'Développons-la avec l’IA : stratégie, audience, piliers.',
    });
    const q = new URLSearchParams({ brandId: data.id, name: form.name });
    if (form.industry) q.set('industry', form.industry);
    if (form.description) q.set('description', form.description);
    router.push(`/pipelines/new?${q.toString()}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Nouvelle marque</CardTitle>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Industrie</Label>
              <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" variant="brand" disabled={loading}>
              {loading ? 'Création…' : 'Créer'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
