'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Brain, Gauge, Clock, Repeat, Dna, Sparkles, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScoreCard } from './ScoreCard';
import { OptimalTimesCard } from './OptimalTimesCard';
import { RepurposeCard } from './RepurposeCard';
import { BrandDNACard } from './BrandDNACard';
import { StrategyReviewsCard } from './StrategyReviewsCard';

interface Brand { id: string; name: string }

export default function IntelligencePage() {
  return (
    <Suspense>
      <IntelligenceContent />
    </Suspense>
  );
}

function IntelligenceContent() {
  const sp = useSearchParams();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string>('');

  useEffect(() => {
    // Priorité : ?brandId= (lien contextualisé) → marque active du sélecteur
    // global → première marque. Avant, la page forçait TOUJOURS la première
    // marque : la sidebar annonçait la marque B, l'analyse portait sur A.
    const urlBrandId = sp.get('brandId');
    Promise.all([
      fetch('/api/brands').then((r) => r.json()).catch(() => null),
      fetch('/api/me/active-brand').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([b, active]) => {
      const list = (b?.data ?? []) as Brand[];
      setBrands(list);
      const activeId = active?.data?.activeBrandId as string | null | undefined;
      const pick =
        (urlBrandId && list.find((x) => x.id === urlBrandId)?.id) ||
        (activeId && list.find((x) => x.id === activeId)?.id) ||
        list[0]?.id ||
        '';
      if (pick) setBrandId(pick);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-6 w-6 text-violet-600" />
            <h1 className="text-2xl font-bold tracking-tight">Recommandations IA</h1>
            <Badge variant="info" className="ml-2">Apprenant</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            La couche qui fait apprendre SocialFlow de chaque publication — score, timing, ADN de marque, repurposing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Marque:</span>
          <select
            className="rounded-md border px-3 py-2 text-sm"
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
          >
            <option value="">— globale —</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {/* Overview row */}
      <div className="grid gap-4 md:grid-cols-4">
        <FeatureTile
          icon={<Gauge className="h-5 w-5 text-emerald-600" />}
          title="Score qualité"
          desc="6 dimensions évaluées avant publication"
        />
        <FeatureTile
          icon={<Clock className="h-5 w-5 text-blue-600" />}
          title="Timing optimal"
          desc="Créneaux empiriques + standards plateforme"
        />
        <FeatureTile
          icon={<Dna className="h-5 w-5 text-violet-600" />}
          title="ADN de marque"
          desc="Extrait + applique automatiquement"
        />
        <FeatureTile
          icon={<Repeat className="h-5 w-5 text-rose-600" />}
          title="Repurposing"
          desc="1 source → N formats taillés"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ScoreCard brandId={brandId} />
        <OptimalTimesCard brandId={brandId} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <BrandDNACard brandId={brandId} />
        <RepurposeCard brandId={brandId} />
      </div>

      <StrategyReviewsCard />

      <Card className="border-violet-200 bg-gradient-to-r from-violet-50 to-rose-50">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Self-improving loop activé
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Chaque semaine, l&apos;agent ré-évalue la stratégie en cours à partir des perfs réelles et propose des ajustements.
            </div>
          </div>
          <Link href="/dashboard">
            <Button variant="outline" size="sm">
              Voir le tableau de bord <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureTile({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardContent>
    </Card>
  );
}
