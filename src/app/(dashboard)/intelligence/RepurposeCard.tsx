'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Repeat, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TARGETS = [
  'INSTAGRAM_POST', 'INSTAGRAM_REEL', 'INSTAGRAM_CAROUSEL',
  'LINKEDIN_POST', 'LINKEDIN_ARTICLE',
  'TWITTER_POST', 'TWITTER_THREAD',
  'TIKTOK_VIDEO', 'YOUTUBE_SHORT',
  'EMAIL_MARKETING', 'VIDEO_SCRIPT',
];

interface Variant {
  target: string;
  platform: string;
  title?: string;
  body: string;
  hashtags: string[];
  cta?: string;
  notes?: string;
  mocked: boolean;
}

export function RepurposeCard({ brandId }: { brandId: string }) {
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [selected, setSelected] = useState<string[]>(['INSTAGRAM_POST', 'LINKEDIN_POST', 'TWITTER_THREAD']);
  const [applyDNA, setApplyDNA] = useState(true);
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [persisting, setPersisting] = useState(false);

  function toggle(t: string) {
    setSelected((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t]);
  }

  async function repurpose(persist = false) {
    if (sourceText.length < 20) return toast.error('Au moins 20 caractères de source');
    if (!selected.length) return toast.error('Choisis au moins un format cible');
    setLoading(true);
    const res = await fetch('/api/intelligence/repurpose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceTitle: sourceTitle || undefined,
        sourceText,
        brandId: brandId || undefined,
        targets: selected,
        applyBrandDNA: applyDNA,
        persistAsDrafts: persist,
      }),
    });
    setLoading(false);
    if (!res.ok) return toast.error('Repurposing échoué');
    const { data } = await res.json();
    setVariants(data.variants);
    if (persist && data.persistedIds?.length) {
      toast.success(`${data.persistedIds.length} brouillons créés`);
    }
  }

  async function persistOnly() {
    setPersisting(true);
    await repurpose(true);
    setPersisting(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="h-5 w-5 text-rose-600" /> Repurposing 1 → N
        </CardTitle>
        <CardDescription>Une source, plusieurs formats taillés.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Titre source (optionnel)" value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} />
        <Textarea rows={4} placeholder="Article, transcript, idée centrale…" value={sourceText} onChange={(e) => setSourceText(e.target.value)} />

        <div>
          <Label className="text-xs">Formats cibles</Label>
          <div className="mt-1 flex flex-wrap gap-1">
            {TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                className={`rounded-md border px-2 py-0.5 text-[10px] ${selected.includes(t) ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={applyDNA} onChange={(e) => setApplyDNA(e.target.checked)} />
          Appliquer l&apos;ADN de marque (si extrait)
        </label>

        <div className="flex gap-2">
          <Button onClick={() => repurpose(false)} disabled={loading} variant="brand" size="sm">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Repeat className="mr-2 h-4 w-4" />}
            Générer variantes
          </Button>
          {variants.length ? (
            <Button onClick={persistOnly} disabled={persisting} variant="outline" size="sm">
              {persisting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Tout en brouillons
            </Button>
          ) : null}
        </div>

        {variants.length ? (
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="rounded-md border bg-slate-50 p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="info" className="text-[10px]">{v.target}</Badge>
                  {v.mocked ? <Badge variant="warning" className="text-[10px]">mock</Badge> : null}
                  <span className="text-[10px] text-muted-foreground">{v.body.length} chars</span>
                </div>
                {v.title ? <div className="font-semibold">{v.title}</div> : null}
                <div className="whitespace-pre-wrap text-slate-800">{v.body}</div>
                {v.hashtags.length ? <div className="mt-1 text-[10px] text-blue-700">{v.hashtags.join(' ')}</div> : null}
                {v.cta ? <div className="mt-1 text-[10px] font-semibold">CTA: {v.cta}</div> : null}
                {v.notes ? <div className="mt-1 rounded bg-amber-50 p-1 text-[10px] italic text-amber-900">{v.notes}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
