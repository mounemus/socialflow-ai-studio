import type { WatchReportContent } from '@/services/watch/IntelligentWatchService';

function Section({ title, items }: { title: string; items?: string[] | null }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

/**
 * Rendu professionnel d'un rapport de veille (tous kinds confondus).
 * Si `onToggleRec` est fourni, les recommandations deviennent sélectionnables
 * pour alimenter une proposition stratégique sur mesure.
 */
export function ReportView({ content, sources, selectedRecs, onToggleRec }: {
  content: WatchReportContent;
  sources?: Array<{ uri?: string; title?: string }> | null;
  selectedRecs?: string[];
  onToggleRec?: (rec: string) => void;
}) {
  return (
    <div className="space-y-4">
      {content.summary ? <p className="text-sm">{content.summary}</p> : null}
      {content.positioning ? (
        <p className="text-sm"><span className="font-semibold">Positionnement :</span> {content.positioning}</p>
      ) : null}

      {content.findings?.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observations</h4>
          <ul className="space-y-2">
            {content.findings.map((f, i) => (
              <li key={i} className="rounded-md border bg-slate-50 p-2 text-sm">
                <span className="font-medium">{f.title}</span>
                {f.detail ? <span className="text-muted-foreground"> — {f.detail}</span> : null}
                {f.sourceUrl ? (
                  <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-xs text-brand-600 hover:underline">source</a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {content.competitors?.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Concurrents identifiés</h4>
          <ul className="space-y-1">
            {content.competitors.map((c, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{c.name}</span>
                {c.website ? (
                  <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-brand-600 hover:underline">{c.website}</a>
                ) : null}
                {c.positioning ? <div className="text-xs text-muted-foreground">{c.positioning}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(content.prices?.length || content.pricing?.length) ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prix observés</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2">Offre</th>
                  {content.prices?.length ? <th className="py-1 pr-2">Fournisseur</th> : null}
                  <th className="py-1 pr-2">Prix</th>
                  <th className="py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {(content.prices ?? content.pricing ?? []).map((p, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2">{p.offer ?? '—'}</td>
                    {content.prices?.length ? <td className="py-1 pr-2">{(p as { provider?: string }).provider ?? '—'}</td> : null}
                    <td className="py-1 pr-2 font-medium">{p.price ?? '—'}</td>
                    <td className="py-1 text-xs text-muted-foreground">{p.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {content.actions?.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan d’action</h4>
          <ul className="space-y-2">
            {content.actions.map((a, i) => (
              <li key={i} className="rounded-md border bg-slate-50 p-2 text-sm">
                <span className="font-medium">{a.title}</span>
                {a.priority ? (
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    a.priority === 'haute' ? 'bg-red-100 text-red-700'
                    : a.priority === 'moyenne' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-200 text-slate-600'
                  }`}>{a.priority}</span>
                ) : null}
                {a.detail ? <div className="text-xs text-muted-foreground">{a.detail}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Section title="KPIs à suivre" items={content.kpis} />
      <Section title="Marketing observé" items={content.marketing} />
      <Section title="Messages clés / angles" items={content.messaging} />
      <Section title="Publications & canaux" items={content.publications} />
      <Section title="Forces" items={content.strengths} />
      <Section title="Faiblesses" items={content.weaknesses} />
      <Section title="Opportunités" items={content.opportunities} />
      <Section title="Risques" items={content.risks} />

      {content.recommendations?.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recommandations{onToggleRec ? ' — coche celles à retenir pour ta stratégie' : ''}
          </h4>
          <ul className="space-y-1 text-sm">
            {content.recommendations.map((rec, i) => (
              <li key={i}>
                {onToggleRec ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md p-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedRecs?.includes(rec) ?? false}
                      onChange={() => onToggleRec(rec)}
                    />
                    <span>{rec}</span>
                  </label>
                ) : (
                  <span className="ml-5 block list-item list-disc">{rec}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {content.selected?.length ? (
        <div className="rounded-md border border-brand-200 bg-brand-50/40 p-2">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choix retenus (mémorisés pour les futures analyses)</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {content.selected.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      ) : null}

      {sources?.length ? (
        <div className="border-t pt-2">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources consultées</h4>
          <ul className="space-y-0.5">
            {sources.slice(0, 10).map((s, i) => (
              <li key={i}>
                <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline">
                  {s.title || s.uri}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
