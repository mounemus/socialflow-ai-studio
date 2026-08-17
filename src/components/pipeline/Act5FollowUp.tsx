'use client';

import Link from 'next/link';
import { CheckCircle2, CalendarClock, AlertTriangle, BarChart3, ListChecks } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { postStatusMeta } from '@/lib/post-status';
import type { PublicationMap } from '@/lib/pipeline-publication';

/**
 * Acte 5 — Suivi : bilan dérivé des posts (publiés / programmés / restants),
 * liens vers ce qui suit (calendrier, file de production, analytique).
 * Remplace l'ancien Acte 5 « Passage à l'action » qui dupliquait les actions
 * de publication et affichait un badge SIMULATION codé en dur.
 */
export function Act5FollowUp({
  run,
}: {
  run?: {
    status?: string;
    brand?: { id: string; name: string } | null;
    strategy?: { items?: Array<{ id: string; title?: string | null; platform?: string | null; status?: string }> } | null;
    itemStates?: Record<string, { status?: string } | unknown> | null;
    publication?: PublicationMap;
  } | null;
  // Bag de props partagé par PipelineRunner — ignoré ici.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}) {
  const states = (run?.itemStates ?? {}) as Record<string, { status?: string } | undefined>;
  const pub = run?.publication ?? {};
  const items = (run?.strategy?.items ?? []).filter((it) => {
    const s = states[it.id]?.status ?? it.status;
    return s === 'APPROVED' || s === 'EDITED' || s === 'EXECUTED';
  });
  const bucket = (id: string) => {
    const s = pub[id]?.post?.status ?? '';
    if (s === 'PUBLISHED' || s === 'SIMULATED') return 'published';
    if (['SCHEDULED', 'QUEUED', 'PUBLISHING', 'PROCESSING', 'UPLOADING'].includes(s)) return 'scheduled';
    if (s === 'FAILED' || s === 'ACTION_REQUIRED') return 'failed';
    return 'todo';
  };
  const published = items.filter((i) => bucket(i.id) === 'published');
  const scheduled = items.filter((i) => bucket(i.id) === 'scheduled');
  const failed = items.filter((i) => bucket(i.id) === 'failed');
  const todo = items.filter((i) => bucket(i.id) === 'todo');
  const allDone = items.length > 0 && todo.length === 0 && failed.length === 0;
  const brandQs = run?.brand?.id ? `?brand=${run.brand.id}` : '';

  return (
    <Card className="border-emerald-200 bg-emerald-50/20" data-act="5">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Acte 5 · SUIVI</span>
          {items.length === 0 ? (
            <Badge variant="secondary" className="text-[10px]">EN ATTENTE</Badge>
          ) : allDone ? (
            <Badge variant="success" className="text-[10px]">TERMINÉ</Badge>
          ) : (
            <Badge variant="info" className="text-[10px]">{published.length + scheduled.length}/{items.length}</Badge>
          )}
        </CardTitle>
        <ListChecks className="h-5 w-5 text-emerald-600" />
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-slate-500">
            Le bilan apparaît dès que des contenus sont validés dans l’Acte 3.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Publiés" value={published.length} />
              <Stat icon={<CalendarClock className="h-4 w-4 text-sky-600" />} label="Programmés" value={scheduled.length} />
              <Stat icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} label="En échec" value={failed.length} />
              <Stat icon={<ListChecks className="h-4 w-4 text-slate-500" />} label="À publier" value={todo.length} />
            </div>
            <ul className="divide-y rounded-md border bg-white text-xs">
              {items.map((it) => {
                const p = pub[it.id];
                const m = postStatusMeta(p?.post?.status);
                return (
                  <li key={it.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate">
                      <span className="mr-2 text-[10px] uppercase text-slate-400">{it.platform ?? ''}</span>
                      {it.title ?? 'Sans titre'}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {p?.post?.scheduledFor && bucket(it.id) === 'scheduled' ? (
                        <span className="text-[10px] text-slate-500">
                          {new Date(p.post.scheduledFor).toLocaleString('fr-CA')}
                        </span>
                      ) : null}
                      <Badge variant={p?.post ? m.variant : 'outline'} className="text-[9px]">
                        {p?.post ? m.label : 'Brouillon en cours'}
                      </Badge>
                      {p?.postId ? (
                        <Link href={`/posts/${p.postId}`} className="text-[10px] text-sky-700 underline">
                          ouvrir
                        </Link>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              {todo.length > 0 ? (
                <Button size="sm" variant="brand" onClick={() => document.getElementById('act-4')?.scrollIntoView({ behavior: 'smooth' })}>
                  Publier les {todo.length} restant{todo.length > 1 ? 's' : ''} (Acte 4)
                </Button>
              ) : null}
              <Link href={`/calendar${brandQs}`}><Button size="sm" variant="outline"><CalendarClock className="mr-1 h-3 w-3" /> Calendrier</Button></Link>
              <Link href="/production"><Button size="sm" variant="outline"><ListChecks className="mr-1 h-3 w-3" /> File de production</Button></Link>
              <Link href="/analytics"><Button size="sm" variant="outline"><BarChart3 className="mr-1 h-3 w-3" /> Mesurer</Button></Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-white px-3 py-2">
      {icon}
      <div>
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="text-[10px] text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export default Act5FollowUp;
