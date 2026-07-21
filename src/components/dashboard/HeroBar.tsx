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
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-rose-500 p-6 text-white shadow-lg">
      {/* decorative blur */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-black/10 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-6">
        {/* Left: greeting + chips */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="border-transparent bg-white/20 text-white backdrop-blur-sm">
              <Building2 className="mr-1 h-3 w-3" />
              {orgName}
            </Badge>
            <Badge className="border-transparent bg-white/15 text-white backdrop-blur-sm">
              {planLabel}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Bonsoir {userFirstName}
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Voici ton cockpit marketing en un coup d&apos;œil.
          </p>

          {/* CTAs */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/pipelines/new">
              <Button
                size="sm"
                className="bg-white text-brand-700 shadow-sm hover:bg-white/90"
              >
                <Plus className="mr-1 h-4 w-4" />
                Pipeline
              </Button>
            </Link>
            <Link href="/brands/new">
              <Button
                size="sm"
                variant="outline"
                className="border-white/40 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
              >
                <Plus className="mr-1 h-4 w-4" />
                Brand
              </Button>
            </Link>
            <Link href="/ai-studio">
              <Button
                size="sm"
                variant="outline"
                className="border-white/40 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
              >
                <Sparkles className="mr-1 h-4 w-4" />
                Studio IA
              </Button>
            </Link>
          </div>
        </div>

        {/* Right: stats + sparkline */}
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap items-center justify-end gap-4 text-right">
            <MiniStat label="Marques" value={brandCount} />
            <MiniStat label="Comptes sociaux" value={socialAccountCount} />
            <MiniStat label="Posts 30j" value={post30dCount} />
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
      <div className="flex h-full items-center justify-end text-[10px] text-white/60">—</div>
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
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={1} />
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
      <div className="text-xl font-bold leading-none">{formatNumber(value)}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-white/70">
        {label}
      </div>
    </div>
  );
}
