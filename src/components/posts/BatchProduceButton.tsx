'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Wand2, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Provider = 'gemini' | 'dalle' | 'flux' | 'auto';

interface BatchResultItem {
  postId: string;
  postTitle?: string;
  status: 'ok' | 'failed';
  error?: string;
}

interface BatchProduceResponse {
  results?: BatchResultItem[];
  ok?: number;
  failed?: number;
}

export function BatchProduceButton({ draftPostIds }: { draftPostIds: string[] }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('gemini');
  const [running, setRunning] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [results, setResults] = useState<BatchResultItem[]>([]);
  const [done, setDone] = useState(false);

  if (draftPostIds.length === 0) return null;

  const N = draftPostIds.length;

  const handleConfirm = async () => {
    setConfirmOpen(false);
    setProgressOpen(true);
    setRunning(true);
    setDone(false);
    setResults([]);

    try {
      const res = await fetch('/api/posts/produce-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: draftPostIds, provider }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as BatchProduceResponse;
      const resultList = data.results ?? [];
      setResults(resultList);
      setDone(true);

      const okCount = resultList.filter((r) => r.status === 'ok').length;
      const failedCount = resultList.filter((r) => r.status === 'failed').length;
      if (failedCount === 0) {
        toast.success(`${okCount} DRAFT(s) produits avec succès`);
      } else {
        toast.warning(`${okCount} OK · ${failedCount} échec(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error(`Production batch échouée : ${msg}`);
      setDone(true);
    } finally {
      setRunning(false);
    }
  };

  const closeProgress = () => {
    if (running) return;
    setProgressOpen(false);
    setResults([]);
    setDone(false);
    // Refresh page so DRAFT statuses update
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <>
      <Button variant="brand" onClick={() => setConfirmOpen(true)} disabled={running}>
        {running ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="mr-2 h-4 w-4" />
        )}
        🎨 Produire les {N} DRAFTs
      </Button>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Produire {N} DRAFT(s)</CardTitle>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Choisis le fournisseur d&apos;image pour générer les visuels.
              </p>
              <div className="space-y-2">
                {(
                  [
                    { value: 'gemini', label: 'Gemini (défaut)' },
                    { value: 'dalle', label: 'DALL-E' },
                    { value: 'flux', label: 'FLUX' },
                    { value: 'auto', label: 'Auto (routage intelligent)' },
                  ] as { value: Provider; label: string }[]
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted/40 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="batch-provider"
                      value={opt.value}
                      checked={provider === opt.value}
                      onChange={() => setProvider(opt.value)}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Annuler
                </Button>
                <Button variant="brand" onClick={handleConfirm}>
                  <Wand2 className="mr-2 h-4 w-4" /> Lancer la production
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {progressOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                {running ? 'Production en cours...' : done ? 'Production terminée' : 'Résultats'}
              </CardTitle>
              <button
                type="button"
                onClick={closeProgress}
                disabled={running}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent className="space-y-3 overflow-y-auto">
              {running && results.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Génération de {N} visuel(s) via {provider}...
                </div>
              ) : null}

              {results.length > 0 ? (
                <ul className="space-y-2">
                  {results.map((r) => (
                    <li
                      key={r.postId}
                      className="flex items-center justify-between rounded-md border p-2 text-sm"
                    >
                      <span className="truncate pr-2">{r.postTitle ?? r.postId}</span>
                      {r.status === 'ok' ? (
                        <Badge variant="success" className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> ok
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> failed
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {done ? (
                <div className="flex justify-end pt-2">
                  <Button onClick={closeProgress}>Fermer</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
