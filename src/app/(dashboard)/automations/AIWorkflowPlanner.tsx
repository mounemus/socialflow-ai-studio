'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ShieldCheck } from 'lucide-react';

interface PlanStep {
  actionType: string;
  rationale?: string;
}
interface PlanResult {
  automationId: string | null;
  plan: { name: string; description?: string; triggerType: string; steps: PlanStep[]; confidence: number; risks: string[] } | null;
  mocked: boolean;
  provider: string;
  error?: string;
}

/**
 * L'agent PROPOSE (workflow créé en DRAFT), l'humain ACTIVE.
 * Claude n'exécute rien et ne garde aucune mémoire : tout est en base.
 */
export function AIWorkflowPlanner() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);

  async function planWorkflow() {
    if (prompt.trim().length < 10) {
      toast.error('Décris le workflow en au moins une phrase.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/agent/workflows/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Erreur de planification');
      setResult(json.data as PlanResult);
      if ((json.data as PlanResult).error) toast.warning((json.data as PlanResult).error);
      else toast.success('Workflow proposé — vérifie les étapes puis active-le.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function activate() {
    if (!result?.automationId) return;
    setActivating(true);
    try {
      const res = await fetch(`/api/agent/workflows/${result.automationId}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error('Activation impossible');
      toast.success('Workflow activé.');
      setResult(null);
      setPrompt('');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setActivating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-brand-600" /> Créer un workflow avec l’agent
        </CardTitle>
        <CardDescription>
          Décris ce que tu veux automatiser en une phrase. L’agent propose un plan — rien ne
          s’exécute avant ton activation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="w-full rounded-md border bg-background p-2 text-sm"
          rows={2}
          placeholder="Ex: Chaque lundi à 9h, génère une idée de post LinkedIn à partir des tendances RSS, prépare le visuel, puis demande ma validation avant publication."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button variant="brand" size="sm" onClick={planWorkflow} disabled={loading}>
            {loading ? 'Planification…' : 'Proposer un workflow'}
          </Button>
          {result?.plan ? (
            <Badge variant={result.mocked ? 'warning' : 'secondary'}>
              {result.mocked ? 'simulation' : `via ${result.provider}`}
            </Badge>
          ) : null}
        </div>

        {result?.plan ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium">{result.plan.name}</div>
              <Badge variant="secondary">confiance {(result.plan.confidence * 100).toFixed(0)}%</Badge>
            </div>
            {result.plan.description ? (
              <p className="mt-1 text-xs text-muted-foreground">{result.plan.description}</p>
            ) : null}
            <div className="mt-2 text-xs text-muted-foreground">Déclencheur : {result.plan.triggerType}</div>
            <ol className="mt-2 space-y-1">
              {result.plan.steps.map((s, i) => (
                <li key={i} className="text-xs">
                  <span className="font-mono">{i + 1}. {s.actionType}</span>
                  {s.rationale ? <span className="text-muted-foreground"> — {s.rationale}</span> : null}
                </li>
              ))}
            </ol>
            {result.plan.risks.length > 0 ? (
              <div className="mt-2 text-xs text-amber-600">
                Risques signalés : {result.plan.risks.join(' · ')}
              </div>
            ) : null}
            <div className="mt-3">
              <Button size="sm" onClick={activate} disabled={activating || !result.automationId}>
                <ShieldCheck className="mr-1 h-3 w-3" />
                {activating ? 'Activation…' : 'Activer ce workflow (validation humaine)'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
