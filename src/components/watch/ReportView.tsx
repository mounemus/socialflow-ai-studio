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

/** Rendu professionnel d'un rapport de veille (tous kinds confondus). */
export function ReportView({ content, sources }: {
  content: WatchReportContent;
  sources?: Array<{ uri?: string; title?: string }> | null;
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

      <Section title="Marketing observé" items={content.marketing} />
      <Section title="Messages clés" items={content.messaging} />
      <Section title="Publications & canaux" items={content.publications} />
      <Section title="Forces" items={content.strengths} />
      <Section title="Faiblesses" items={content.weaknesses} />
      <Section title="Opportunités" items={content.opportunities} />
      <Section title="Risques" items={content.risks} />
      <Section title="Recommandations" items={content.recommendations} />

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
