'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PromptAssistButton } from '@/components/ai/PromptAssistButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ImagePlus, Download, Copy, Loader2, RefreshCw } from 'lucide-react';

interface Brand { id: string; name: string }
type GenResult = { ok: boolean; url?: string; provider?: string; mocked?: boolean; mediaId?: string; error?: string };

const ASPECTS = [
  { value: '1:1', label: 'Carré (1:1)', size: '1024×1024', hint: 'Instagram post, LinkedIn' },
  { value: '4:5', label: 'Portrait (4:5)', size: '832×1024', hint: 'Instagram portrait' },
  { value: '9:16', label: 'Story / Reel (9:16)', size: '720×1280', hint: 'Stories, Reels, TikTok' },
  { value: '16:9', label: 'Paysage (16:9)', size: '1280×720', hint: 'YouTube, web banner' },
];

const STYLES = [
  { value: '', label: 'Aucun (laisser libre)' },
  { value: 'photorealistic, high detail, professional photography', label: 'Photoréaliste' },
  { value: 'minimal, clean, editorial design', label: 'Minimaliste' },
  { value: 'vibrant colors, bold, energetic', label: 'Vif & énergique' },
  { value: 'cinematic lighting, moody atmosphere', label: 'Cinématique' },
  { value: 'flat design, illustration, vector style', label: 'Illustration flat' },
  { value: '3d render, smooth surfaces, soft lighting', label: '3D render' },
  { value: 'film grain, analog photography, 35mm', label: 'Argentique' },
  { value: 'studio shot, white background, product photography', label: 'Studio produit' },
];

/**
 * `initialBrandId` permet à l'Atelier créatif de transmettre la marque choisie
 * dans l'onglet Brief : sans cela chaque onglet repartait de « sans marque » et
 * le contexte se perdait entre les étapes.
 */
export function ImageStudio({ initialBrandId }: { initialBrandId?: string } = {}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState({
    prompt: '',
    aspectRatio: '1:1',
    styleHint: '',
    variants: 1,
    brandId: initialBrandId ?? '',
  });

  // Suit les changements de marque faits en amont (onglet Brief).
  useEffect(() => {
    if (initialBrandId) setForm((f) => (f.brandId === initialBrandId ? f : { ...f, brandId: initialBrandId }));
  }, [initialBrandId]);
  const [results, setResults] = useState<GenResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastPromptUsed, setLastPromptUsed] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => setBrands(d.data ?? []));
  }, []);

  async function generate() {
    if (form.prompt.length < 3) return toast.error('Décris l\'image (au moins 3 caractères)');
    setLoading(true);
    setResults([]);
    const res = await fetch('/api/ai/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Génération échouée');
    }
    const { data } = await res.json();
    setResults(data.images);
    setLastPromptUsed(data.promptUsed);
    const successes = data.images.filter((i: GenResult) => i.ok).length;
    if (successes === 0) toast.error('Aucune image générée');
    else toast.success(`${successes} image${successes > 1 ? 's' : ''} générée${successes > 1 ? 's' : ''} en ${(data.durationMs / 1000).toFixed(1)}s`);
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    toast.success('URL copiée');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-4">
      {/* === FORM === */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImagePlus className="h-4 w-4" /> Paramètres
          </CardTitle>
          <CardDescription>
            fal.ai (FLUX) en priorité, puis Replicate, Nano Banana, DALL-E ou Stability
            selon la disponibilité et tes réglages dans Paramètres → Modèles IA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Marque (style auto)</Label>
            <select className="h-10 w-full rounded-md border px-3 text-sm" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
              <option value="">— sans marque —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="text-[10px] text-muted-foreground">Si choisi, on ajoute le style visuel de la marque au prompt.</p>
          </div>

          <div className="space-y-1">
            <Label>Format</Label>
            <select className="h-10 w-full rounded-md border px-3 text-sm" value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}>
              {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label} — {a.hint}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Style</Label>
            <select className="h-10 w-full rounded-md border px-3 text-sm" value={form.styleHint} onChange={(e) => setForm({ ...form, styleHint: e.target.value })}>
              {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Variantes</Label>
            <select className="h-10 w-full rounded-md border px-3 text-sm" value={form.variants} onChange={(e) => setForm({ ...form, variants: parseInt(e.target.value, 10) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} image{n > 1 ? 's' : ''}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* === GENERATION === */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Prompt</CardTitle>
          <CardDescription>Décris l'image. En anglais pour de meilleurs résultats.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            rows={3}
            placeholder="Ex: A modern 3D-printed eyewear product shot on a white background, studio lighting, ultra detailed"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <PromptAssistButton
              kind="image"
              draft={form.prompt}
              brandId={form.brandId || undefined}
              onResult={(p) => setForm((f) => ({ ...f, prompt: p }))}
              label="Rédiger le prompt avec l’IA"
            />
            <Button onClick={generate} variant="brand" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              {loading ? 'Génération… (5-30s)' : `Générer ${form.variants > 1 ? `${form.variants} variantes` : ''}`}
            </Button>
            {results.length > 0 ? (
              <Button variant="outline" onClick={generate} disabled={loading}>
                <RefreshCw className="mr-2 h-3 w-3" /> Régénérer
              </Button>
            ) : null}
          </div>

          {lastPromptUsed && lastPromptUsed !== form.prompt ? (
            <div className="rounded-lg border border-dashed bg-slate-50 p-2 text-xs text-muted-foreground">
              <strong>Prompt enrichi envoyé:</strong> {lastPromptUsed}
            </div>
          ) : null}

          {/* === RESULTS === */}
          {results.length > 0 ? (
            <div className={results.length === 1 ? '' : 'grid grid-cols-2 gap-3'}>
              {results.map((r, i) => (
                <div key={i} className="overflow-hidden rounded-lg border bg-slate-50">
                  {r.ok && r.url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt={`Variant ${i + 1}`} className="w-full" />
                      <div className="flex items-center justify-between p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant={r.mocked ? 'warning' : 'success'}>
                            {r.mocked ? `Mock (${r.provider})` : r.provider}
                          </Badge>
                          {r.mediaId ? <Badge variant="secondary">Sauvé</Badge> : null}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => copyUrl(r.url!)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                          <a href={r.url} download={`socialflow-${Date.now()}.png`} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm">
                              <Download className="h-3 w-3" />
                            </Button>
                          </a>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p-4 text-center text-xs text-rose-600">❌ {r.error ?? 'Échec'}</div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
