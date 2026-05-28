'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Dna, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DNA {
  voiceFingerprint: string;
  signatureMoves: string[];
  narrativeThemes: string[];
  vocabularyPatterns: { powerWords: string[]; avoidedWords: string[]; signaturePhrases: string[] };
  structuralTics: string[];
  audienceSignals: string[];
  sample: { count: number; source: string };
  extractedAt: string;
  mocked: boolean;
}

export function BrandDNACard({ brandId }: { brandId: string }) {
  const [dna, setDna] = useState<DNA | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!brandId) { setDna(null); return; }
    fetch(`/api/intelligence/extract-dna?brandId=${brandId}`).then((r) => r.json()).then(({ data }) => setDna(data?.dna ?? null));
  }, [brandId]);

  async function extract() {
    if (!brandId) return toast.error('Choisis une marque');
    setLoading(true);
    const res = await fetch('/api/intelligence/extract-dna', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId }),
    });
    setLoading(false);
    if (!res.ok) return toast.error('Extraction échouée');
    const { data } = await res.json();
    setDna(data.dna);
  }

  async function save() {
    if (!brandId || !dna) return;
    setSaving(true);
    const res = await fetch('/api/intelligence/extract-dna', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId, save: true }),
    });
    setSaving(false);
    if (!res.ok) return toast.error('Sauvegarde échouée');
    const { data } = await res.json();
    setDna(data.dna);
    toast.success('ADN sauvegardé — sera appliqué aux futures générations.');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Dna className="h-5 w-5 text-violet-600" /> ADN de marque
        </CardTitle>
        <CardDescription>Extraction à partir des posts publiés + profil. Application automatique aux générations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button onClick={extract} disabled={loading || !brandId} variant="brand" size="sm">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Dna className="mr-2 h-4 w-4" />}
            Extraire l&apos;ADN
          </Button>
          {dna ? (
            <Button onClick={save} disabled={saving} variant="outline" size="sm">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Activer
            </Button>
          ) : null}
        </div>

        {dna ? (
          <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{dna.sample.count} échantillons</Badge>
              <Badge variant="secondary">{dna.sample.source}</Badge>
              {dna.mocked ? <Badge variant="warning">mock</Badge> : null}
              <span className="text-[10px] text-muted-foreground">{new Date(dna.extractedAt).toLocaleString('fr-FR')}</span>
            </div>
            <div>
              <div className="font-semibold">Empreinte vocale</div>
              <div className="italic text-slate-700">&laquo; {dna.voiceFingerprint} &raquo;</div>
            </div>
            {dna.signatureMoves.length ? (
              <div>
                <div className="font-semibold">Signatures rhétoriques</div>
                <ul className="ml-4 list-disc">{dna.signatureMoves.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            ) : null}
            {dna.narrativeThemes.length ? (
              <div>
                <div className="font-semibold">Thèmes</div>
                <div className="flex flex-wrap gap-1">{dna.narrativeThemes.map((t, i) => <Badge key={i} variant="outline" className="text-[10px]">{t}</Badge>)}</div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="font-semibold">Power words</div>
                <div className="text-[11px] text-slate-700">{dna.vocabularyPatterns.powerWords.join(', ') || '—'}</div>
              </div>
              <div>
                <div className="font-semibold">À éviter</div>
                <div className="text-[11px] text-rose-700">{dna.vocabularyPatterns.avoidedWords.join(', ') || '—'}</div>
              </div>
            </div>
            {dna.vocabularyPatterns.signaturePhrases.length ? (
              <div>
                <div className="font-semibold">Phrases signature</div>
                <div className="text-[11px] italic">&laquo; {dna.vocabularyPatterns.signaturePhrases.join(' &raquo; / &laquo; ')} &raquo;</div>
              </div>
            ) : null}
            {dna.structuralTics.length ? (
              <div>
                <div className="font-semibold">Structure</div>
                <ul className="ml-4 list-disc">{dna.structuralTics.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center text-xs text-muted-foreground">
            {brandId ? 'Aucun ADN extrait — clique sur Extraire.' : 'Choisis une marque en haut de page.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
