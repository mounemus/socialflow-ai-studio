'use client';

import Link from 'next/link';
import { Plus, Sparkles, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';

export interface HeroBarProps {
  userFirstName: string;
  orgName: string;
  planLabel: string;
  brandCount: number;
  socialAccountCount: number;
  post30dCount: number;
  sparkline14d: { date: string; value: number }[];
}

export function HeroBar({
  userFirstName,
  orgName,
  planLabel,
  brandCount,
  socialAccountCount,
  post30dCount,
  sparkline14d,
}: HeroBarProps) {
  // Refonte « Orbit » : accueil éditorial — date en surtitre, salutation à
  // l'encre sur papier, une action principale. Fini le dégradé violet.
  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="rounded-xl border bg-card p-6 shadow-[0_3px_9px_rgba(39,41,33,0.03)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        {/* Left: date + greeting */}
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{today}</div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Bonjour {userFirstName},
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre stratégie avance. Voici ce qui mérite votre attention aujourd&apos;hui.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-border text-muted-foreground">
              <Building2 className="mr-1 h-3 w-3" />
              {orgName}
            </Badge>
            <Badge variant="outline" className="border-border text-muted-foreground">
              {planLabel}
            </Badge>
          </div>

          {/* CTAs : une action principale, deux secondaires */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href="/studio">
              <Button size="sm" className="bg-brand-500 text-white shadow-sm hover:bg-brand-600">
                <Sparkles className="mr-1 h-4 w-4" />
                Créer un contenu
              </Button>
            </Link>
            <Link href="/pipelines/new">
              <Button size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />
                Stratégie
              </Button>
            </Link>
            <Link href="/brands/new">
              <Button size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />
                Marque
              </Button>
            </Link>
          </div>
        </div>

        {/* Right: la marque en un coup d'œil */}
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap items-center justify-end gap-6 text-right">
            <MiniStat label="Marques" value={brandCount} />
            <MiniStat label="Comptes sociaux" value={socialAccountCount} />
            <MiniStat label="Publiés 30 j" value={post30dCount} />
          </div>
          <div className="h-[30px] w-[80px]">
            <Sparkline points={sparkline14d} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sparkline 14 jours en SVG natif.
 *
 * Auparavant rendue avec recharts : ~300 ko de JavaScript chargés et parsés sur
 * la page d'accueil du dashboard avant l'hydratation, pour un graphique de
 * 80×30 px — d'où une page affichée mais non cliquable pendant plusieurs
 * secondes. Le tracé ci-dessous ne coûte rien et rend le même résultat.
 */
function Sparkline({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-full items-center justify-end text-[10px] text-muted-foreground">—</div>
    );
  }
  const W = 80;
  const H = 30;
  const PAD = 2;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (W - PAD * 2) / (points.length - 1);
  const path = values
    .map((v, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      role="img"
      aria-label="Tendance des publications sur 14 jours"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ee6d3c" stopOpacity={0.45} />
          <stop offset="100%" stopColor="#ee6d3c" stopOpacity={1} />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="url(#sparkStroke)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <div className="text-xl font-extrabold leading-none text-foreground">{formatNumber(value)}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
