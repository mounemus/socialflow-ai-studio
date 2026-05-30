'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Palette,
  Sparkles,
  ImageIcon,
  Wand2,
  Star,
  Loader2,
  X,
  Check,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types — mirror server response shapes loosely (be defensive: the produce
// endpoint may degrade to mocks and omit fields).
// ---------------------------------------------------------------------------

interface PromptSet {
  imagePrompt: string;
  videoPrompt?: string;
  captionPrompt: string;
  aspectRatio?: string;
  reasoning?: string;
}

interface Variant {
  url: string;
  provider: string;
  mediaId?: string;
  mocked?: boolean;
  prompt?: string;
}

type ProviderKey = 'gemini' | 'dalle' | 'flux' | 'canva';

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  gemini: 'Gemini',
  canva: 'Canva',
  dalle: 'OpenAI Image',
  flux: 'FLUX',
};

export interface ProducePostDialogProps {
  open: boolean;
  onClose: () => void;
  postId: string;
  postTitle?: string | null;
  format?: string | null;
  brandName?: string | null;
  brandId?: string | null;
  /**
   * If the post originates from a pipeline strategy item, pass it through so
   * "Mark ready" can hit /api/pipelines/[id]/items/[itemId]/ready instead of
   * a plain PATCH. Both are optional — when missing we fall back to PATCH.
   */
  originPipelineId?: string | null;
  originStrategyItemId?: string | null;
  /** Called after a successful produce or mark-ready so the parent can refresh. */
  onProduced?: () => void;
}

export function ProducePostDialog({
  open,
  onClose,
  postId,
  postTitle,
  format,
  brandName,
  brandId: _brandId,
  originPipelineId,
  originStrategyItemId,
  onProduced,
}: ProducePostDialogProps) {
  // _brandId is reserved for future per-brand template selection — keep in the
  // signature so callers can wire it now without an API break later.
  void _brandId;

  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [prompts, setPrompts] = useState<PromptSet | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<ProviderKey | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [coverBusy, setCoverBusy] = useState<string | null>(null);
  const [coverChosen, setCoverChosen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  // === Auto-load prompts on first open ===
  useEffect(() => {
    if (!open) return;
    if (prompts !== null) return; // already loaded
    let cancel = false;
    setLoadingPrompts(true);
    fetch(`/api/posts/${postId}/produce/prompts`, { method: 'POST' })
      .then((r) => r.json())
      .then(({ data }) => {
        if (cancel) return;
        if (!data) {
          toast.error('Génération des prompts échouée');
          return;
        }
        setPrompts({
          imagePrompt: data.imagePrompt ?? '',
          videoPrompt: data.videoPrompt ?? undefined,
          captionPrompt: data.captionPrompt ?? '',
          aspectRatio: data.aspectRatio,
          reasoning: data.reasoning,
        });
      })
      .catch(() => !cancel && toast.error('Impossible de charger les prompts'))
      .finally(() => !cancel && setLoadingPrompts(false));
    return () => {
      cancel = true;
    };
  }, [open, postId, prompts]);

  // === Reset on close ===
  useEffect(() => {
    if (open) return;
    // Defer reset until after the fade-out so the user briefly sees their state
    const t = setTimeout(() => {
      setPrompts(null);
      setVariants([]);
      setCoverChosen(null);
      setExpanded(null);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  // === Close on Escape ===
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expanded) setExpanded(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, expanded]);

  const generateForProvider = useCallback(
    async (provider: ProviderKey) => {
      setLoadingProvider(provider);
      try {
        const res = await fetch(`/api/posts/${postId}/produce`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providers: [provider] }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.message ?? `Génération ${PROVIDER_LABEL[provider]} échouée`);
          return;
        }
        const { data } = await res.json();
        const newOnes: Variant[] = (data?.variants ?? []).map((v: Variant) => ({
          url: v.url,
          provider: v.provider ?? provider,
          mediaId: v.mediaId,
          mocked: v.mocked,
          prompt: v.prompt,
        }));
        setVariants((prev) => [...newOnes, ...prev]);
        toast.success(
          `${newOnes.length} visuel${newOnes.length > 1 ? 's' : ''} ${PROVIDER_LABEL[provider]}`,
        );
        onProduced?.();
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoadingProvider(null);
      }
    },
    [postId, onProduced],
  );

  const useAsFinal = useCallback(
    async (variant: Variant) => {
      setCoverBusy(variant.url);
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            metadata: {
              coverMediaId: variant.mediaId ?? variant.url,
              coverUrl: variant.url,
            },
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.message ?? 'Sauvegarde du visuel échouée');
          return;
        }
        setCoverChosen(variant.url);
        toast.success('Visuel défini comme final', {
          description: 'Cette image servira de couverture au post.',
        });
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setCoverBusy(null);
      }
    },
    [postId],
  );

  const markReady = useCallback(async () => {
    setMarking(true);
    try {
      // Prefer pipeline ready endpoint when both ids are present.
      if (originPipelineId && originStrategyItemId) {
        const res = await fetch(
          `/api/pipelines/${originPipelineId}/items/${originStrategyItemId}/ready`,
          { method: 'POST' },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.message ?? 'Validation pipeline échouée');
          return;
        }
        toast.success('Item marqué prêt pour revue');
      } else {
        const res = await fetch(`/api/posts/${postId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          // The Prisma enum exposes PENDING_APPROVAL (this schema's equivalent
          // of READY_FOR_REVIEW — see ContentProductionService doc comment).
          body: JSON.stringify({ status: 'PENDING_APPROVAL' }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.message ?? 'Mise à jour statut échouée');
          return;
        }
        toast.success('Post prêt pour revue');
      }
      onProduced?.();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMarking(false);
    }
  }, [originPipelineId, originStrategyItemId, postId, onClose, onProduced]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <Card className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col bg-white shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b">
          <div className="flex min-w-0 items-center gap-2">
            <Palette className="h-5 w-5 shrink-0 text-fuchsia-600" />
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">
                Produire — {postTitle ?? 'Brouillon'}
              </CardTitle>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                {brandName ? <Badge variant="secondary" className="text-[10px]">{brandName}</Badge> : null}
                {format ? <Badge variant="secondary" className="text-[10px]">{format}</Badge> : null}
                <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700 text-[10px]">
                  Multi-IA
                </Badge>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>

        <CardContent className="space-y-4 overflow-y-auto p-4">
          {/* === PROMPTS === */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Prompts générés
              </Label>
              {loadingPrompts ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Chargement…
                </span>
              ) : prompts ? (
                <Badge variant="secondary" className="text-[10px]">
                  <Wand2 className="mr-1 h-3 w-3" /> éditable
                </Badge>
              ) : null}
            </div>

            {loadingPrompts && !prompts ? (
              <div className="rounded-md border border-dashed bg-slate-50 p-4 text-center text-xs text-muted-foreground">
                Génération des prompts en cours…
              </div>
            ) : prompts ? (
              <div className="grid gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-slate-500">Image</Label>
                  <Textarea
                    rows={3}
                    className="text-xs"
                    value={prompts.imagePrompt}
                    onChange={(e) =>
                      setPrompts((p) => (p ? { ...p, imagePrompt: e.target.value } : p))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-slate-500">Caption</Label>
                  <Textarea
                    rows={2}
                    className="text-xs"
                    value={prompts.captionPrompt}
                    onChange={(e) =>
                      setPrompts((p) => (p ? { ...p, captionPrompt: e.target.value } : p))
                    }
                  />
                </div>
                {prompts.videoPrompt !== undefined ? (
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-slate-500">Vidéo</Label>
                    <Textarea
                      rows={2}
                      className="text-xs"
                      value={prompts.videoPrompt ?? ''}
                      onChange={(e) =>
                        setPrompts((p) => (p ? { ...p, videoPrompt: e.target.value } : p))
                      }
                    />
                  </div>
                ) : null}
                {prompts.reasoning ? (
                  <p className="text-[11px] italic text-slate-500">{prompts.reasoning}</p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-slate-50 p-4 text-center text-xs text-muted-foreground">
                Aucun prompt — ouvrez à nouveau pour réessayer.
              </div>
            )}
          </section>

          {/* === PROVIDERS === */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Générer visuels via
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateForProvider('gemini')}
                disabled={loadingProvider !== null || !prompts}
              >
                {loadingProvider === 'gemini' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3 w-3" />
                )}
                Gemini
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateForProvider('dalle')}
                disabled={loadingProvider !== null || !prompts}
                title="OpenAI gpt-image-1 — meilleur pour text-in-image (ads, headlines)"
              >
                {loadingProvider === 'dalle' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <ImageIcon className="mr-1 h-3 w-3" />
                )}
                OpenAI Image
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateForProvider('flux')}
                disabled={loadingProvider !== null || !prompts}
              >
                {loadingProvider === 'flux' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Palette className="mr-1 h-3 w-3" />
                )}
                FLUX
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateForProvider('canva')}
                disabled={loadingProvider !== null || !prompts}
                title="Canva — utilise un brand template si lié à la marque, sinon génère depuis le brand kit"
              >
                {loadingProvider === 'canva' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="mr-1 h-3 w-3" />
                )}
                Canva
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              💡 Le prompt image ci-dessus est modifiable — édite-le avant de cliquer un provider pour personnaliser le rendu.
            </p>
          </section>

          {/* === VARIANTS === */}
          {variants.length > 0 ? (
            <section className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Variantes ({variants.length})
              </Label>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {variants.map((v, i) => {
                  const isChosen = coverChosen === v.url;
                  return (
                    <div
                      key={`${v.url}-${i}`}
                      className={`space-y-2 rounded-lg border bg-white p-2 ${
                        isChosen ? 'border-fuchsia-400 ring-2 ring-fuchsia-200' : ''
                      }`}
                    >
                      {v.url ? (
                        <button
                          type="button"
                          onClick={() => setExpanded(v.url)}
                          className="block w-full"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={v.url}
                            alt={`Variante ${i + 1}`}
                            className="aspect-square w-full rounded object-cover transition hover:opacity-90"
                          />
                        </button>
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
                          {v.provider}
                          {v.mocked ? ' (mock)' : ''}
                        </Badge>
                        {isChosen ? (
                          <Badge variant="success" className="text-[9px]">
                            <Check className="mr-0.5 h-3 w-3" /> Final
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant={isChosen ? 'outline' : 'brand'}
                        className="h-7 w-full text-[10px]"
                        onClick={() => useAsFinal(v)}
                        disabled={coverBusy === v.url || !v.url || isChosen}
                      >
                        {coverBusy === v.url ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Star className="mr-1 h-3 w-3" />
                        )}
                        {isChosen ? 'Choisi' : 'Use as final'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </CardContent>

        {/* === FOOTER === */}
        <div className="flex flex-col gap-2 border-t bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {coverChosen
              ? 'Visuel final sélectionné — tu peux marquer le post prêt pour revue.'
              : 'Choisis un visuel final avant de marquer prêt.'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Fermer
            </Button>
            <Button
              variant="brand"
              size="sm"
              onClick={markReady}
              disabled={marking}
            >
              {marking ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <ExternalLink className="mr-1 h-3 w-3" />
              )}
              Mark ready
            </Button>
          </div>
        </div>
      </Card>

      {/* === LIGHTBOX === */}
      {expanded ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setExpanded(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expanded}
            alt="Aperçu"
            className="max-h-[90vh] max-w-[90vw] rounded shadow-2xl"
          />
        </div>
      ) : null}
    </div>
  );
}
