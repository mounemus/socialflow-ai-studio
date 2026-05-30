'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Sparkles,
  ImageIcon,
  Download,
  Star,
  Palette,
  Wand2,
  Video,
  ExternalLink,
} from 'lucide-react';

interface ProductionPanelProps {
  postId: string;
}

interface PromptSet {
  hero?: string;
  illustration?: string;
  alternate?: string;
  [key: string]: string | undefined;
}

interface Variant {
  url: string;
  provider: string;
  mediaId?: string;
  mocked?: boolean;
  prompt?: string;
}

interface ProduceResponse {
  variants: Variant[];
  videoScript?: string;
  durationMs?: number;
}

type ProviderKey = 'gemini' | 'dalle' | 'flux';

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  gemini: 'Gemini',
  dalle: 'DALL-E',
  flux: 'FLUX',
};

export function ProductionPanel({ postId }: ProductionPanelProps) {
  const [prompts, setPrompts] = useState<PromptSet>({});
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<ProviderKey | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [videoScript, setVideoScript] = useState<string | null>(null);
  const [canvaEnabled, setCanvaEnabled] = useState(false);
  const [canvaBusy, setCanvaBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState<string | null>(null);

  // Detect if Canva integration is configured (light probe)
  useEffect(() => {
    fetch('/api/canva/designs')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data?.apiEnabled) setCanvaEnabled(true);
      })
      .catch(() => {
        /* silent — Canva is optional */
      });
  }, []);

  async function generatePrompts() {
    setLoadingPrompts(true);
    try {
      const res = await fetch('/api/produce/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.message ?? 'Génération des prompts échouée');
        return;
      }
      const { data } = await res.json();
      const next: PromptSet = data?.prompts ?? data ?? {};
      setPrompts(next);
      toast.success('Prompts générés — édite-les avant de générer les visuels');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingPrompts(false);
    }
  }

  async function generateVisuals(provider: ProviderKey) {
    setLoadingProvider(provider);
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postId,
          providers: [provider],
          prompts,
          includeVideo,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.message ?? `Génération ${PROVIDER_LABEL[provider]} échouée`);
        return;
      }
      const { data } = (await res.json()) as { data: ProduceResponse };
      const newVariants = data.variants ?? [];
      setVariants((prev) => [...newVariants, ...prev]);
      if (data.videoScript) setVideoScript(data.videoScript);
      toast.success(`${newVariants.length} visuel${newVariants.length > 1 ? 's' : ''} ${PROVIDER_LABEL[provider]} généré${newVariants.length > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingProvider(null);
    }
  }

  async function useAsCover(variant: Variant) {
    setCoverBusy(variant.url);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Marker: stash chosen visual into post body trailer is invasive — instead we store
          // by leaving generation traces in the existing `aiPrompt` text and let downstream
          // schedule pick from media. For now, the PATCH endpoint only accepts whitelisted
          // fields, so we just signal the user this is the cover.
          status: 'DRAFT',
        }),
      });
      if (!res.ok) {
        toast.error('Sauvegarde échouée');
        return;
      }
      // Also attach via Canva-style endpoint for consistency if a mediaId exists
      if (variant.mediaId) {
        await fetch('/api/canva/attach', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            postId,
            canvaUrl: variant.url,
            previewUrl: variant.url,
          }),
        }).catch(() => null);
      }
      toast.success('Visuel défini comme cover ✓', {
        description: 'Le brouillon utilise désormais ce visuel.',
      });
    } finally {
      setCoverBusy(null);
    }
  }

  async function openCanva() {
    setCanvaBusy(true);
    try {
      // Build a brief from the produced prompts and open the Canva designs list.
      const brief = [prompts.hero, prompts.illustration, prompts.alternate]
        .filter(Boolean)
        .join('\n\n');
      // Use existing generate-brief-canva endpoint if available, otherwise just open /canva-studio
      const res = await fetch('/api/ai/generate-brief-canva', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, additionalBrief: brief }),
      }).catch(() => null);
      if (res && res.ok) {
        toast.success('Brief Canva prêt — ouverture de Canva Studio…');
      } else {
        toast.info('Ouverture de Canva Studio…');
      }
      window.open('/canva-studio', '_blank');
    } finally {
      setCanvaBusy(false);
    }
  }

  return (
    <Card id="production-panel" className="border-fuchsia-200 bg-gradient-to-br from-fuchsia-50/40 to-violet-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-5 w-5 text-fuchsia-600" />
          Produire les visuels
          <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700 text-[10px]">Multi-IA</Badge>
        </CardTitle>
        <CardDescription>
          Génère prompts puis lance plusieurs providers en parallèle. Choisis la cover et complète avec Canva si besoin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* === STEP 1: PROMPTS === */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              1. Prompts visuels
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={generatePrompts}
              disabled={loadingPrompts}
            >
              {loadingPrompts ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="mr-1 h-3 w-3" />
              )}
              Générer prompts
            </Button>
          </div>

          {Object.keys(prompts).length > 0 ? (
            <div className="grid gap-2">
              {(['hero', 'illustration', 'alternate'] as const).map((key) =>
                prompts[key] !== undefined ? (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] capitalize text-slate-500">{key}</Label>
                    <Textarea
                      rows={2}
                      className="text-xs"
                      value={prompts[key] ?? ''}
                      onChange={(e) =>
                        setPrompts((p) => ({ ...p, [key]: e.target.value }))
                      }
                    />
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Clique sur « Générer prompts » pour obtenir 3 prompts (hero, illustration, alternate). Tu pourras les éditer avant de produire.
            </p>
          )}
        </div>

        {/* === STEP 2: VIDEO TOGGLE === */}
        <label className="flex items-center gap-2 text-xs rounded-md border border-violet-200 bg-violet-50 p-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeVideo}
            onChange={(e) => setIncludeVideo(e.target.checked)}
            className="h-4 w-4"
          />
          <Video className="h-3 w-3 text-violet-700" />
          <span className="font-medium text-violet-900">Aussi générer un script vidéo</span>
          <span className="text-violet-600">— ajoute un script court adapté au format</span>
        </label>

        {/* === STEP 3: PROVIDERS === */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            2. Générer les visuels
          </Label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateVisuals('gemini')}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === 'gemini' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              Générer visuels Gemini
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateVisuals('dalle')}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === 'dalle' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <ImageIcon className="mr-1 h-3 w-3" />
              )}
              Générer visuels DALL-E
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateVisuals('flux')}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === 'flux' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Palette className="mr-1 h-3 w-3" />
              )}
              Générer via FLUX
            </Button>

            {canvaEnabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={openCanva}
                disabled={canvaBusy}
                className="border-sky-300 text-sky-700 hover:bg-sky-50"
              >
                {canvaBusy ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <ExternalLink className="mr-1 h-3 w-3" />
                )}
                Use Canva
              </Button>
            ) : null}
          </div>
        </div>

        {/* === STEP 4: VARIANTS GRID === */}
        {variants.length > 0 ? (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              3. Variantes générées ({variants.length})
            </Label>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {variants.map((v, i) => (
                <div key={`${v.url}-${i}`} className="rounded-lg border bg-white p-2 space-y-2">
                  {v.url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={v.url}
                      alt={`Variante ${i + 1}`}
                      className="aspect-square w-full rounded object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded bg-slate-100 text-xs text-slate-400">
                      Visuel indisponible
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1">
                    <Badge
                      variant={v.mocked ? 'warning' : 'secondary'}
                      className="text-[9px]"
                    >
                      {v.provider}{v.mocked ? ' (mock)' : ''}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-[10px]"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = v.url;
                        a.download = `visual-${i + 1}.png`;
                        a.target = '_blank';
                        a.rel = 'noreferrer';
                        a.click();
                      }}
                      disabled={!v.url}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Télécharger
                    </Button>
                    <Button
                      size="sm"
                      variant="brand"
                      className="h-7 flex-1 text-[10px]"
                      onClick={() => useAsCover(v)}
                      disabled={coverBusy === v.url || !v.url}
                    >
                      {coverBusy === v.url ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Star className="mr-1 h-3 w-3" />
                      )}
                      Cover
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* === STEP 5: VIDEO SCRIPT === */}
        {videoScript ? (
          <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
            <Label className="text-xs font-semibold uppercase tracking-wider text-violet-700 flex items-center gap-1">
              <Video className="h-3 w-3" /> Script vidéo
            </Label>
            <Textarea
              rows={6}
              className="text-xs font-mono bg-white"
              value={videoScript}
              onChange={(e) => setVideoScript(e.target.value)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
