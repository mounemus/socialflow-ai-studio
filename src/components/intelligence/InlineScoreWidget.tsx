'use client';
import { useState } from 'react';
import { Gauge, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
  brandConsistency: 'Marque', hookQuality: 'Hook', ctaClarity: 'CTA',
  hashtagRelevance: 'Tags', formatFit: 'Format', viralityPotential: 'Viral',
};

function verdictColor(v: ContentScore['verdict']) {
  switch (v) {
    case 'EXCELLENT': return 'success';
    case 'GOOD': return 'info';
    case 'NEEDS_WORK': return 'warning';
    case 'POOR': return 'destructive';
  }
}

export function InlineScoreWidget(props: {
  body: string;
  hashtags?: string[];
  cta?: string | null;
  platform?: string;
  format?: string;
  language?: string;
  brandId?: string | null;
  postId?: string;
}) {
  const [score, setScore] = useState<ContentScore | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!props.body || props.body.length < 5) return;
    setLoading(true);
    const res = await fetch('/api/intelligence/score-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(props.postId
        ? { postId: props.postId }
        : { body: props.body, hashtags: props.hashtags, cta: props.cta ?? null, platform: props.platform, format: props.format, language: props.language, brandId: props.brandId ?? null }
      ),
    });
    setLoading(false);
    if (res.ok) {
      const { data } = await res.json();
      setScore(data);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Gauge className="h-4 w-4 text-emerald-600" /> Score qualité
        </div>
        <Button onClick={run} disabled={loading || !props.body} variant="outline" size="sm">
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Gauge className="mr-1 h-3 w-3" />}
          {score ? 'Re-scorer' : 'Scorer'}
        </Button>
      </div>
      {score ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">{score.overall}</span>
            <span className="text-[10px] text-muted-foreground">/100</span>
            <Badge variant={verdictColor(score.verdict) as never}>{score.verdict}</Badge>
            {score.mocked ? <Badge variant="warning" className="text-[10px]">mock</Badge> : null}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Object.entries(score.dimensions).map(([k, d]) => (
              <div key={k} className="rounded border bg-white p-1">
                <div className="text-[10px] font-medium">{DIM_LABEL[k] ?? k}</div>
                <div className="text-sm font-bold">{d.score}</div>
              </div>
            ))}
          </div>
          {score.topSuggestions.length ? (
            <div>
              <div className="text-[10px] font-semibold text-emerald-800">Top améliorations:</div>
              <ul className="ml-4 list-disc text-[11px] text-slate-700">
                {score.topSuggestions.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}
          {score.riskFlags.length ? (
            <div className="rounded bg-rose-50 p-1">
              <div className="text-[10px] font-semibold text-rose-800">Risques:</div>
              <ul className="ml-4 list-disc text-[11px] text-rose-700">
                {score.riskFlags.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-muted-foreground">Évalue le contenu sur 6 dimensions avant publication.</div>
      )}
    </div>
  );
}
