'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const PLATFORMS = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'];
const FORMATS = [
  'INSTAGRAM_POST', 'INSTAGRAM_STORY', 'INSTAGRAM_REEL', 'INSTAGRAM_CAROUSEL',
  'FACEBOOK_POST', 'LINKEDIN_POST', 'LINKEDIN_ARTICLE', 'TWITTER_POST', 'TWITTER_THREAD',
  'TIKTOK_VIDEO', 'YOUTUBE_SHORT', 'PINTEREST_PIN',
  'EMAIL_MARKETING', 'NEWSLETTER', 'AD_VISUAL', 'VIDEO_SCRIPT',
];

interface Brand { id: string; name: string }

export function TextStudio() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState({
    brandId: '',
    platform: 'INSTAGRAM',
    format: 'INSTAGRAM_POST',
    tone: '',
    audience: '',
    cta: '',
    language: 'fr',
    prompt: '',
  });
  const [result, setResult] = useState<{ text: string; provider: string; mocked: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => setBrands(d.data ?? []));
  }, []);

  async function generate(saveAsDraft = false) {
    if (form.prompt.length < 5) {
      toast.error('Décris le contenu à générer (au moins 5 caractères)');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/ai/generate-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, saveAsDraft }),
    });
    setLoading(false);
    if (!res.ok) {
      toast.error('Génération échouée');
      return;
    }
    const { data } = await res.json();
    setResult(data);
    if (saveAsDraft) toast.success('Brouillon enregistré');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Paramètres</CardTitle>
          <CardDescription>Ces paramètres pilotent la qualité.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Marque</Label>
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
              <option value="">— sans marque —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Plateforme</Label>
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Format</Label>
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Ton</Label>
            <Input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="inspirant, didactique…" />
          </div>
          <div className="space-y-1">
            <Label>Audience</Label>
            <Input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="entrepreneurs B2B, parents…" />
          </div>
          <div className="space-y-1">
            <Label>CTA</Label>
            <Input value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} placeholder="Découvre →" />
          </div>
          <div className="space-y-1">
            <Label>Langue</Label>
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Brief & génération</CardTitle>
          <CardDescription>Décris ce que tu veux. L'IA s'adapte à la marque.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            rows={6}
            placeholder="Ex: annonce du lancement de notre nouveau produit X, ton chaleureux, mettre l'accent sur la durabilité"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => generate(false)} variant="brand" disabled={loading}>
              {loading ? 'Génération…' : 'Générer'}
            </Button>
            <Button onClick={() => generate(true)} variant="outline" disabled={loading}>
              Générer + enregistrer en brouillon
            </Button>
          </div>

          {result ? (
            <div className="rounded-lg border bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant={result.mocked ? 'warning' : 'success'}>
                  {result.mocked ? `Mock (${result.provider})` : `Réel (${result.provider})`}
                </Badge>
              </div>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{result.text}</pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
