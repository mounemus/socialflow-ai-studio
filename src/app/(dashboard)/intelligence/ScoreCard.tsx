'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Gauge } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

interface ScoringDimension { score: number; rationale: string; suggestions: string[] }
interface ContentScore {
  overall: number;
  verdict: 'EXCELLENT' | 'GOOD' | 'NEEDS_WORK' | 'POOR';
  dimensions: Record<string, ScoringDimension>;
  topSuggestions: string[];
  riskFlags: string[];
  mocked: boolean;
}

const DIM_LABEL: Record<string, string> = {
  brandConsistency: 'Cohérence marque',
  hookQuality: 'Hook',
  ctaClarity: 'Clarté CTA',
  hashtagRelevance: 'Hashtags',
  formatFit: 'Format',
  viralityPotential: 'Potentiel viral',
};

function verdictColor(v: ContentScore['verdict']) {
  switch (v) {
    case 'EXCELLENT': return 'success';
    case 'GOOD': return 'info';
    case 'NEEDS_WORK': return 'warning';
    case 'POOR': return 'destructive';
  }
}

export function ScoreCard({ brandId }: { brandId: string }) {
  const [body, setBody] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [cta, setCta] = useState('');
  const [platform, setPlatform] = useState('INSTAGRAM');
  const [format, setFormat] = useState('INSTAGRAM_POST');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContentScore | null>(null);

  async function score() {
    if (body.length < 5) return toast.error('Au moins 5 caractères');
    setLoading(true);
    const res = await fetch('/api/intelligence/score-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body,
        hashtags: hashtags.split(/\s+/).filter(Boolean),
        cta: cta || null,
        platform, format,
        brandId: brandId || null,
      }),
    });
    setLoading(false);
    if (!res.ok) return toast.error('Scoring échoué');
    const { data } = await res.json();
    setResult(data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-emerald-600" /> Score qualité de contenu
        </CardTitle>
        <CardDescription>6 dimensions évaluées avant publication.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={4} placeholder="Colle ton post ici…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Hashtags</Label>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#tag1 #tag2" />
          </div>
          <div>
            <Label className="text-xs">CTA</Label>
            <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Découvre →" />
          </div>
          <div>
            <Label className="text-xs">Plateforme</Label>
            <select className="w-full rounded-md border px-2 py-2 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Format</Label>
            <select className="w-full rounded-md border px-2 py-2 text-sm" value={format} onChange={(e) => setFormat(e.target.value)}>
              {['INSTAGRAM_POST', 'INSTAGRAM_REEL', 'LINKEDIN_POST', 'TWITTER_POST', 'TIKTOK_VIDEO'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <Button onClick={score} disabled={loading} variant="brand" size="sm">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gauge className="mr-2 h-4 w-4" />}
          Évaluer
        </Button>

        {result ? (
          <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">{result.overall}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
              <Badge variant={verdictColor(result.verdict) as never}>{result.verdict}</Badge>
              {result.mocked ? <Badge variant="warning" className="text-[10px]">mock</Badge> : null}
            </div>
            <div className="space-y-1">
              {Object.entries(result.dimensions).map(([k, d]) => (
                <div key={k} className="text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{DIM_LABEL[k] ?? k}</span>
                    <span>{d.score}/100</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded bg-slate-200">
                    <div className="h-full bg-emerald-500" style={{ width: `${d.score}%` }} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{d.rationale}</div>
                </div>
              ))}
            </div>
            {result.topSuggestions.length ? (
              <div>
                <div className="text-xs font-semibold">Top améliorations</div>
                <ul className="ml-4 list-disc text-xs text-slate-700">
                  {result.topSuggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            ) : null}
            {result.riskFlags.length ? (
              <div>
                <div className="text-xs font-semibold text-rose-700">Risques</div>
                <ul className="ml-4 list-disc text-xs text-rose-700">
                  {result.riskFlags.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
