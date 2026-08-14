'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface Brand { id: string; name: string }
interface Design { id: string; url: string; previewUrl?: string; title?: string; source: string }

export default function CanvaStudioPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [apiEnabled, setApiEnabled] = useState(false);
  const [brief, setBrief] = useState('');
  const [briefForm, setBriefForm] = useState({ brandId: '', format: 'INSTAGRAM_POST', topic: '', cta: '', tone: '' });

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => setBrands(d.data ?? []));
    fetch('/api/canva/designs').then((r) => r.json()).then((d) => {
      setDesigns(d.data?.designs ?? []);
      setApiEnabled(d.data?.apiEnabled ?? false);
    });
  }, []);

  async function generateBrief(e: React.FormEvent) {
    e.preventDefault();
    if (!briefForm.brandId || !briefForm.topic) return toast.error('Marque et sujet requis');
    const res = await fetch('/api/ai/generate-brief-canva', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(briefForm),
    });
    if (!res.ok) return toast.error('Erreur');
    const { data } = await res.json();
    setBrief(data.brief);
  }

  return (
    <div className="space-y-6">
      {/* Bannière de migration retirée : elle renvoyait vers /studio, dont le
          bouton « Ouvrir Canva Studio » ramenait ici — boucle sans fin. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Studio Canva</h1>
          <p className="text-sm text-muted-foreground">Crée, importe et associe tes designs Canva.</p>
        </div>
        <Badge variant={apiEnabled ? 'success' : 'warning'}>
          {apiEnabled ? 'API Canva connectée' : 'Mode manuel (fallback)'}
        </Badge>
      </div>

      {!apiEnabled ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <strong>Mode fallback :</strong> tu peux coller un lien Canva, téléverser un export, ou générer un brief IA prêt à copier dans Canva.
          L'API Canva Connect nécessite une validation par Canva (voir docs/API_LIMITS.md).
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Générer un brief IA pour Canva</CardTitle>
            <CardDescription>Brief prêt à coller dans Canva.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={generateBrief} className="space-y-3">
              <div className="space-y-1">
                <Label>Marque</Label>
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={briefForm.brandId} onChange={(e) => setBriefForm({ ...briefForm, brandId: e.target.value })}>
                  <option value="">—</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Format</Label>
                <Input value={briefForm.format} onChange={(e) => setBriefForm({ ...briefForm, format: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Sujet</Label>
                <Input value={briefForm.topic} onChange={(e) => setBriefForm({ ...briefForm, topic: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>CTA</Label>
                <Input value={briefForm.cta} onChange={(e) => setBriefForm({ ...briefForm, cta: e.target.value })} />
              </div>
              <Button type="submit" variant="brand">Générer le brief</Button>
            </form>
            {brief ? (
              <Textarea className="mt-4 font-mono text-xs" rows={15} value={brief} readOnly />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Designs enregistrés</CardTitle>
            <CardDescription>Liens Canva associés à tes posts.</CardDescription>
          </CardHeader>
          <CardContent>
            {designs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun design enregistré.</p>
            ) : (
              <ul className="divide-y">
                {designs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:underline">
                      {d.title ?? d.url}
                    </a>
                    <Badge variant="secondary">{d.source}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
