'use client';

/**
 * Veille intelligente — 3 analyses IA (marché & tendances, concurrence, prix)
 * lancées avec le contexte de la marque active ; rapports sourcés persistants.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ReportView } from '@/components/watch/ReportView';
import type { WatchReportContent } from '@/services/watch/IntelligentWatchService';
import { Radar, TrendingUp, Swords, Tags, Loader2, ChevronDown, ChevronUp, Trash2, UserPlus } from 'lucide-react';

export type SerializedReport = {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  content: WatchReportContent;
  sources: Array<{ uri?: string; title?: string }>;
};

const KIND_META: Record<string, { label: string; badge: 'info' | 'success' | 'secondary' }> = {
  MARKET: { label: 'Marché & tendances', badge: 'info' },
  COMPETITION: { label: 'Concurrence', badge: 'secondary' },
  PRICING: { label: 'Prix', badge: 'success' },
};

const ANALYSES = [
  {
    kind: 'MARKET' as const,
    icon: TrendingUp,
    title: 'Marché & tendances',
    desc: 'Tendances du secteur, évolutions de la demande, signaux faibles — sourcés et datés.',
  },
  {
    kind: 'COMPETITION' as const,
    icon: Swords,
    title: 'Veille concurrentielle',
    desc: 'Concurrents réels identifiés, positionnements, mouvements marketing observés.',
  },
  {
    kind: 'PRICING' as const,
    icon: Tags,
    title: 'Veille prix',
    desc: 'Prix publics du marché pour des offres comparables et positionnement recommandé.',
  },
];

export function WatchClient({ brandName, configured, reports }: {
  brandName: string | null;
  configured: boolean;
  reports: SerializedReport[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(reports[0]?.id ?? null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [following, setFollowing] = useState<string | null>(null);

  async function runOne(kind: 'MARKET' | 'COMPETITION' | 'PRICING'): Promise<boolean> {
    const res = await fetch('/api/watch/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.data?.error) {
      toast.error(`${KIND_META[kind].label} : ${json?.data?.error ?? json?.message ?? 'analyse impossible'}`.slice(0, 200));
      return false;
    }
    return true;
  }

  async function run(kind: 'MARKET' | 'COMPETITION' | 'PRICING') {
    setRunning(kind);
    try {
      if (await runOne(kind)) {
        toast.success(`${KIND_META[kind].label} : rapport prêt.`);
        setOpenId(null);
        router.refresh();
      }
    } finally {
      setRunning(null);
    }
  }

  /** Veille complète — les trois analyses en parallèle. */
  async function runAll() {
    setRunning('ALL');
    try {
      const results = await Promise.all(
        (['MARKET', 'COMPETITION', 'PRICING'] as const).map((k) => runOne(k)),
      );
      const done = results.filter(Boolean).length;
      if (done > 0) {
        toast.success(`Veille complète : ${done}/3 rapport${done > 1 ? 's' : ''} prêt${done > 1 ? 's' : ''}.`);
        setOpenId(null);
        router.refresh();
      }
    } finally {
      setRunning(null);
    }
  }

  async function removeReport(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/watch/reports/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Suppression impossible');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  /** Suivre un concurrent découvert par la veille — bascule dans le module Concurrents. */
  async function followCompetitor(c: { name?: string; website?: string }) {
    if (!c.name) return;
    setFollowing(c.name);
    try {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          ...(c.website ? { website: c.website.startsWith('http') ? c.website : `https://${c.website}` } : {}),
        }),
      });
      if (!res.ok) throw new Error('Ajout impossible');
      toast.success(`${c.name} ajouté aux Concurrents — lance son analyse depuis la page Concurrents.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFollowing(null);
    }
  }

  return (
    <div className="space-y-6">
      {!configured && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Clé GOOGLE_GEMINI_API_KEY absente — la veille IA a besoin de la recherche web Gemini.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-brand-50/40 p-4">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Veille complète{brandName ? ` — ${brandName}` : ''}</div>
          <p className="text-xs text-muted-foreground">
            Les trois analyses (marché & tendances, concurrence, prix) en une fois, avec le contexte de ta marque.
          </p>
        </div>
        <Button variant="brand" disabled={!configured || running !== null} onClick={() => void runAll()}>
          {running === 'ALL' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
          {running === 'ALL' ? 'Veille en cours (~40 s)…' : 'Lancer la veille complète'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {ANALYSES.map((a) => (
          <Card key={a.kind}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <a.icon className="h-4 w-4 text-brand-600" /> {a.title}
              </CardTitle>
              <CardDescription className="text-xs">{a.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm" variant="ghost"
                className="text-xs"
                disabled={!configured || running !== null}
                onClick={() => void run(a.kind)}
              >
                {running === a.kind ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Radar className="mr-1 h-3 w-3" />}
                {running === a.kind ? 'Analyse…' : 'Relancer seule'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Rapports ({reports.length})</h2>
        {reports.length === 0 ? (
          <EmptyState
            icon={<Radar className="h-10 w-10" />}
            title="Aucun rapport pour l'instant"
            description="Lance une analyse ci-dessus — l'IA observe le web avec le contexte de ta marque."
          />
        ) : (
          reports.map((r) => {
            const meta = KIND_META[r.kind] ?? { label: r.kind, badge: 'secondary' as const };
            const open = openId === r.id;
            return (
              <Card key={r.id}>
                <CardHeader className="cursor-pointer py-3" onClick={() => setOpenId(open ? null : r.id)}>
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      {r.title}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={meta.badge}>{meta.label}</Badge>
                      <span className="text-xs font-normal text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString('fr-CA')}
                      </span>
                      <button
                        type="button"
                        title="Supprimer le rapport"
                        onClick={(e) => { e.stopPropagation(); void removeReport(r.id); }}
                        disabled={deleting === r.id}
                        className="rounded p-1 hover:bg-slate-100"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </span>
                  </CardTitle>
                </CardHeader>
                {open && (
                  <CardContent className="border-t pt-4">
                    <ReportView content={r.content} sources={r.sources} />
                    {r.kind === 'COMPETITION' && r.content.competitors?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                        {r.content.competitors.filter((c) => c.name).map((c) => (
                          <Button
                            key={c.name} size="sm" variant="outline"
                            disabled={following !== null}
                            onClick={() => void followCompetitor(c)}
                          >
                            {following === c.name ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <UserPlus className="mr-1 h-3 w-3" />}
                            Suivre {c.name}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
