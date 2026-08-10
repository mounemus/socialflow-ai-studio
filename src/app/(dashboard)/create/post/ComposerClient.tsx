'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Sparkles,
  ImagePlus,
  Loader2,
  Send,
  ArrowRight,
  PencilLine,
  Share2,
  Clapperboard,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PromptAssistButton } from '@/components/ai/PromptAssistButton';
import { AttachVisual } from '@/components/media/AttachVisual';
import { SocialTextEditor } from '@/components/ui/social-text-editor';
import { apiErrorMessage } from '@/lib/client-api-error';
import { sanitizeSocialText } from '@/lib/social-text';

interface Brand {
  id: string;
  name: string;
  profile?: { primaryColor?: string | null } | null;
}

/** Types de support par plateforme — évite le piège « LinkedIn → INSTAGRAM_POST ». */
const FORMAT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  INSTAGRAM: [
    { value: 'INSTAGRAM_POST', label: 'Post' },
    { value: 'INSTAGRAM_CAROUSEL', label: 'Carrousel' },
    { value: 'INSTAGRAM_REEL', label: 'Reel' },
    { value: 'INSTAGRAM_STORY', label: 'Story' },
  ],
  FACEBOOK: [
    { value: 'FACEBOOK_POST', label: 'Post' },
    { value: 'FACEBOOK_STORY', label: 'Story' },
  ],
  LINKEDIN: [
    { value: 'LINKEDIN_POST', label: 'Post' },
    { value: 'LINKEDIN_ARTICLE', label: 'Article' },
  ],
  TWITTER: [
    { value: 'TWITTER_POST', label: 'Post' },
    { value: 'TWITTER_THREAD', label: 'Thread' },
  ],
  TIKTOK: [{ value: 'TIKTOK_VIDEO', label: 'Vidéo' }],
  YOUTUBE: [
    { value: 'YOUTUBE_SHORT', label: 'Short' },
    { value: 'YOUTUBE_THUMBNAIL', label: 'Miniature' },
  ],
  PINTEREST: [{ value: 'PINTEREST_PIN', label: 'Épingle' }],
};
const PLATFORMS = Object.keys(FORMAT_OPTIONS);

/** Formats vidéo : le bloc 3 propose « Générer la vidéo (IA) » au lieu de l'image. */
const VIDEO_FORMATS = new Set([
  'INSTAGRAM_REEL',
  'INSTAGRAM_STORY',
  'FACEBOOK_STORY',
  'TIKTOK_VIDEO',
  'YOUTUBE_SHORT',
]);

/** Segment à trous type `[produit]` — sert à détecter un échafaudage non rempli. */
const BRACKET_RE = /\[[^\]\n]{2,60}\]/;

type VisualProvider = 'auto' | 'fal' | 'flux' | 'gpt-image' | 'dalle' | 'gemini' | 'stability';

/**
 * Fournisseurs d'image. Tous sont publiables : les visuels base64 (OpenAI,
 * Gemini) sont exposés via `/api/media/[id]/raw`, qui leur donne une URL
 * publique téléchargeable par les réseaux.
 */
const VISUAL_PROVIDERS: Array<{ value: VisualProvider; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto (recommandé)', hint: 'Le meilleur fournisseur disponible est choisi automatiquement.' },
  { value: 'fal', label: 'FLUX (fal.ai)', hint: 'Rapide, photoréaliste — image déjà hébergée.' },
  { value: 'flux', label: 'FLUX (Replicate)', hint: 'Alternative FLUX si fal.ai est indisponible.' },
  { value: 'gpt-image', label: 'GPT Image (OpenAI)', hint: 'Excellent quand l’image doit contenir du texte lisible.' },
  { value: 'dalle', label: 'DALL-E 3', hint: 'Rendu artistique OpenAI, alternative à GPT Image.' },
  { value: 'gemini', label: 'Gemini (Nano Banana)', hint: 'Bon rendu graphique et compositions créatives.' },
  { value: 'stability', label: 'Stability AI', hint: 'Modèles Stable Diffusion, style photo ou illustration.' },
];

/** Squelettes de publication : brief + corps à trous, prêts à personnaliser. */
const TEMPLATES: Array<{ label: string; brief: string; body: string }> = [
  {
    label: 'Annonce',
    brief: 'Annonce d’une nouveauté de la marque',
    body: '📣 Grande nouvelle !\n\nNous lançons [produit] : [bénéfice principal].\n\n✅ [avantage 1]\n✅ [avantage 2]\n\n👉 [appel à l’action]',
  },
  {
    label: 'Astuce',
    brief: 'Astuce pratique pour notre audience',
    body: '💡 Astuce du jour\n\nVous voulez [objectif] ? Voici comment :\n\n1. [étape 1]\n2. [étape 2]\n3. [étape 3]\n\nEnregistrez ce post pour plus tard ✅',
  },
  {
    label: 'Témoignage',
    brief: 'Témoignage d’un client satisfait',
    body: '❤️ Merci [client] !\n\n« [citation du client sur le bénéfice obtenu] »\n\nRésultat : [résultat concret].\n\n👉 Envie du même résultat ? [appel à l’action]',
  },
  {
    label: 'Coulisses',
    brief: 'Coulisses de l’équipe ou de la production',
    body: '🎬 Dans les coulisses\n\nAujourd’hui, on vous emmène découvrir [ce qui se passe en interne].\n\nCe qu’on en retient : [leçon ou anecdote].\n\nUne question ? Posez-la en commentaire 👇',
  },
  {
    label: 'Promotion',
    brief: 'Offre promotionnelle à durée limitée',
    body: '🔥 Offre limitée\n\n[produit] à [offre / réduction] jusqu’au [date].\n\n✅ [bénéfice 1]\n✅ [bénéfice 2]\n\n👉 [appel à l’action] avant qu’il ne soit trop tard !',
  },
  {
    label: 'Question',
    brief: 'Question ouverte à la communauté',
    body: '🤔 On veut votre avis !\n\n[question ouverte liée à votre domaine] ?\n\nOption A : [choix 1]\nOption B : [choix 2]\n\nDites-nous tout en commentaire 👇',
  },
];

interface Adaptation {
  id: string;
  label: string;
  platform: string | null;
  body: string;
  mocked?: boolean;
}

/**
 * Composeur unifié — UNE publication, texte + visuel combinés.
 *
 * Remplace le parcours éclaté du Studio (onglets Texte et Visuel produisant
 * deux artefacts sans lien, aperçu portant sur un autre post) : ici tout
 * s'applique au MÊME brouillon, créé dès la première action et enrichi ensuite.
 * On termine sur la vue publication (/posts/[id]) pour publier ou programmer.
 */
export function ComposerClient({ brands, defaultBrandId }: { brands: Brand[]; defaultBrandId: string | null }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(defaultBrandId ?? brands[0]?.id ?? '');
  const [platform, setPlatform] = useState('LINKEDIN');
  // Langue du CONTENU généré (texte, voix off, textes à l'écran) — fr par défaut.
  const [language, setLanguage] = useState('fr');
  const [format, setFormat] = useState(FORMAT_OPTIONS.LINKEDIN[0].value);
  const [brief, setBrief] = useState('');
  const [body, setBody] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [postId, setPostId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Id du visuel courant : régénérer REMPLACE (on supprime le précédent) au
  // lieu d'empiler — sinon la publication partait avec toutes les versions.
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [visualProvider, setVisualProvider] = useState<VisualProvider>('auto');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [videoState, setVideoState] = useState<
    | { phase: 'idle' }
    | { phase: 'processing'; predictionId: string; model: string }
    | { phase: 'ready'; url: string; model: string }
    | { phase: 'failed'; error: string }
  >({ phase: 'idle' });
  const [adaptTargets, setAdaptTargets] = useState<string[]>([]);
  const [adaptations, setAdaptations] = useState<Adaptation[]>([]);
  const [busy, setBusy] = useState<'text' | 'improve' | 'visual' | 'adapt' | 'save' | null>(null);

  const brand = brands.find((b) => b.id === brandId) ?? null;
  const isVideoFormat = VIDEO_FORMATS.has(format);
  const isCarouselFormat = format === 'INSTAGRAM_CAROUSEL';

  // Le brouillon est créé une seule fois, puis réutilisé par toutes les actions
  // (texte, visuel, publication) — c'est ce qui garantit que tout est combiné.
  const ensurePost = useCallback(async (): Promise<string> => {
    if (postId) {
      await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body,
          hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
          // Si la plateforme a changé après la création, le format doit suivre —
          // sinon le post garde le format de la plateforme initiale.
          format,
        }),
      });
      return postId;
    }
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brandId: brandId || undefined,
        format,
        title: (body || brief).slice(0, 80) || 'Nouvelle publication',
        body,
        hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
        status: 'DRAFT',
      }),
    });
    if (!res.ok) throw new Error(await apiErrorMessage(res));
    const json = await res.json();
    const id = json?.data?.id as string;
    setPostId(id);
    return id;
  }, [postId, body, hashtags, brandId, format, brief]);

  const applyTemplate = useCallback(
    (tpl: (typeof TEMPLATES)[number]) => {
      if (body.trim() && !window.confirm('Remplacer le texte actuel par ce template ?')) return;
      setBrief(tpl.brief);
      setBody(tpl.body);
    },
    [body],
  );

  const generateText = useCallback(async () => {
    if (brief.trim().length < 3) {
      toast.error('Décrivez en une phrase ce que vous voulez publier.');
      return;
    }
    setBusy('text');
    try {
      // Si un template à trous est déjà dans le corps, on le fournit comme
      // structure à suivre — sinon l'IA doit juste éviter d'en produire un.
      const hasPlaceholders = BRACKET_RE.test(body);
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: brandId || undefined,
          platform,
          format,
          prompt: brief,
          language,
          ...(hasPlaceholders ? { draft: body } : {}),
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = await res.json();
      const text = (json?.data?.text ?? '') as string;
      if (!text) throw new Error('Aucun texte généré');
      setBody(text);
      // L'IA renvoie aussi des hashtags — on les pré-remplit plutôt que de
      // laisser l'utilisateur les retaper.
      const tags = (json?.data?.hashtags ?? []) as string[];
      if (tags.length > 0 && !hashtags.trim()) setHashtags(tags.join(' '));
      if (json?.data?.mocked === true) {
        toast.warning('Texte simulé — aucun modèle IA disponible (Paramètres → Modèles IA).');
      } else if (BRACKET_RE.test(text)) {
        toast.warning('Le texte contient encore des [champs à compléter] — complète-les avant de publier.');
      } else {
        toast.success('Texte généré — modifiez-le librement.');
      }
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [brief, body, brandId, platform, format, hashtags]);

  /** Réécriture par l'IA du texte existant — même fond, meilleure forme. */
  const improveText = useCallback(async () => {
    if (!body.trim()) return;
    setBusy('improve');
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: brandId || undefined,
          platform,
          format,
          language,
          prompt: `Améliore cette publication (accroche, clarté, structure, émojis sobres) sans en changer le fond ni la langue :\n\n${body}`,
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = await res.json();
      const text = (json?.data?.text ?? '') as string;
      if (!text) throw new Error('Aucun texte renvoyé');
      setBody(sanitizeSocialText(text));
      const tags = (json?.data?.hashtags ?? []) as string[];
      if (tags.length > 0 && !hashtags.trim()) setHashtags(tags.join(' '));
      toast.success('Texte amélioré — vérifiez le résultat.');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [body, brandId, platform, format, hashtags]);

  const generateVisual = useCallback(async () => {
    if (!body.trim()) {
      toast.error('Écrivez ou générez d’abord le texte — le visuel s’en inspire.');
      return;
    }
    setBusy('visual');
    try {
      const id = await ensurePost();
      // `produce` génère le visuel ET l'attache au post (MediaAsset) — c'est
      // ce qui « combine » texte et image sur une seule publication.
      const res = await fetch(`/api/posts/${id}/produce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // FLUX renvoie une URL HTTPS hébergée ; DALL-E/Gemini renvoient du
        // base64, non publiable tant que le stockage (SUPABASE_*) n'est pas
        // configuré. On privilégie donc un visuel directement diffusable.
        body: JSON.stringify({
          maxVariants: 1,
          providers: [visualProvider],
          // Prompt utilisateur : prioritaire sur le prompt dérivé du texte.
          ...(visualPrompt.trim() ? { prompt: visualPrompt.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = await res.json();
      const url = (json?.data?.variants ?? []).map((v: { url?: string }) => v?.url).find(Boolean);
      const newMediaId = (json?.data?.mediaAssetIds ?? [])[0] as string | undefined;
      if (url) {
        // Remplacement : on retire l'ancien visuel pour qu'un seul parte.
        if (mediaId && newMediaId && mediaId !== newMediaId) {
          await fetch(`/api/media/${mediaId}`, { method: 'DELETE' }).catch(() => {});
        }
        setMediaId(newMediaId ?? null);
        setImageUrl(url as string);
        toast.success('Visuel généré et attaché à la publication.');
      } else {
        toast.warning('Aucun visuel produit — réessayez ou publiez sans visuel.');
      }
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [body, ensurePost, visualProvider, visualPrompt, mediaId]);

  /** Lance une génération vidéo réelle (Replicate/fal.ai) — jamais de vidéo simulée. */
  const generateVideoAI = useCallback(async () => {
    const prompt = visualPrompt.trim() || body.slice(0, 500);
    if (!prompt.trim()) {
      toast.error('Écrivez ou générez d’abord le texte — la vidéo s’en inspire.');
      return;
    }
    try {
      const res = await fetch('/api/ai/generate-video', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, brandId: brandId || undefined, aspectRatio: '9:16', language }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Lancement impossible');
      if (json.data?.available === false) {
        setVideoState({ phase: 'failed', error: json.data.reason });
        toast.warning(json.data.reason);
        return;
      }
      setVideoState({ phase: 'processing', predictionId: json.data.predictionId, model: json.data.model });
      toast.info('Génération vidéo lancée — quelques minutes (statut en direct ci-dessous).');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    }
  }, [visualPrompt, body, brandId, language]);

  // Poll toutes les 5s tant que la vidéo est en traitement — même schéma que
  // le Studio (StudioShell.tsx). À la réussite : on crée/actualise le
  // brouillon PUIS on y attache le média, pour disposer d'un postId.
  useEffect(() => {
    if (videoState.phase !== 'processing') return;
    const { predictionId } = videoState;
    const t = setInterval(async () => {
      const res = await fetch(
        `/api/ai/generate-video?id=${encodeURIComponent(predictionId)}${brandId ? `&brandId=${brandId}` : ''}`,
      );
      if (!res.ok) return;
      const { data } = await res.json();
      if (data.status === 'READY') {
        setVideoState({ phase: 'ready', url: data.url, model: data.model });
        try {
          const id = await ensurePost();
          if (data.mediaId) {
            await fetch(`/api/posts/${id}/media`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ mediaId: data.mediaId, replace: false }),
            });
          }
          toast.success('Vidéo générée et attachée à la publication.');
        } catch {
          toast.success('Vidéo générée.');
        }
      } else if (data.status === 'FAILED') {
        setVideoState({ phase: 'failed', error: data.error });
        toast.error(`Vidéo : ${data.error}`.slice(0, 120));
      }
    }, 5000);
    return () => clearInterval(t);
  }, [videoState, brandId, ensurePost]);

  /** Adaptations par réseau : une variante IA par plateforme cochée. */
  const generateAdaptations = useCallback(async () => {
    if (!body.trim()) {
      toast.error('Écrivez d’abord le texte de la publication.');
      return;
    }
    if (adaptTargets.length === 0) {
      toast.error('Cochez au moins un réseau à adapter.');
      return;
    }
    setBusy('adapt');
    try {
      const id = await ensurePost();
      const res = await fetch(`/api/posts/${id}/variants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platforms: adaptTargets }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = await res.json();
      setAdaptations((json?.data ?? []) as Adaptation[]);
      toast.success('Adaptations générées.');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [body, adaptTargets, ensurePost]);

  const finish = useCallback(async () => {
    if (!body.trim()) {
      toast.error('La publication est vide.');
      return;
    }
    setBusy('save');
    try {
      const id = await ensurePost();
      toast.success('Publication prête.');
      router.push(`/posts/${id}`);
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [body, ensurePost, router]);

  const tags = hashtags.split(/[\s,]+/).filter(Boolean);
  const otherPlatforms = PLATFORMS.filter((p) => p !== platform);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <PencilLine className="h-6 w-6 text-sky-600" /> Nouvelle publication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Texte et visuel sur une seule publication — puis publiez ou programmez.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ====== COMPOSITION ====== */}
        <div className="space-y-4">
          {/* 1 · Cible */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">1 · Où publier ?</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Marque</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Plateforme</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={platform}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPlatform(next);
                    // Le format suit la plateforme — plus de LinkedIn en INSTAGRAM_POST.
                    setFormat(FORMAT_OPTIONS[next][0].value);
                  }}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Type de support</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {FORMAT_OPTIONS[platform].map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Langue du contenu</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  S&apos;applique au texte, à la voix off et aux textes visibles des visuels.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 2 · Texte */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">2 · Le texte</CardTitle>
              <CardDescription>Écrivez directement, ou laissez l’IA proposer une base.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Templates : squelettes prêts à personnaliser */}
              <div className="space-y-1">
                <Label className="text-xs">Templates</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="rounded-full border px-3 py-1 text-xs text-slate-600 transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="En une phrase : de quoi parle la publication ?"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
                <Button variant="outline" onClick={generateText} disabled={busy !== null}>
                  {busy === 'text' ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  Générer avec l’IA
                </Button>
              </div>

              <SocialTextEditor
                value={body}
                onChange={setBody}
                rows={10}
                placeholder="Le texte de votre publication…"
                onImprove={improveText}
                improving={busy === 'improve'}
              />
              <div className="space-y-1">
                <Label className="text-xs">Hashtags</Label>
                <Input
                  placeholder="#emploi #carriere"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* 3 · Visuel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">3 · Le visuel (optionnel)</CardTitle>
              <CardDescription>
                Généré à partir de votre texte et du style de la marque, puis attaché à cette
                publication.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Ou joins un visuel existant :</Label>
                <AttachVisual
                  postId={postId}
                  ensurePostId={ensurePost}
                  brandId={brandId}
                  replace
                  onAttached={(m) => {
                    setMediaId(m.id);
                    setImageUrl(m.url);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prompt du visuel (optionnel)</Label>
                <Textarea
                  rows={3}
                  placeholder="Décrivez l’image souhaitée — sinon elle sera déduite du texte de la publication."
                  value={visualPrompt}
                  onChange={(e) => setVisualPrompt(e.target.value)}
                />
                <PromptAssistButton
                  kind="image"
                  draft={visualPrompt || body}
                  brandId={brandId || undefined}
                  platform={platform}
                  format={format}
                  onResult={setVisualPrompt}
                  label="Rédiger le prompt avec l’IA"
                />
              </div>
              {isVideoFormat ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={generateVideoAI}
                      disabled={videoState.phase === 'processing'}
                    >
                      {videoState.phase === 'processing' ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Clapperboard className="mr-1 h-4 w-4" />
                      )}
                      {videoState.phase === 'processing' ? 'Génération en cours…' : 'Générer la vidéo (IA)'}
                    </Button>
                    {videoState.phase === 'processing' ? (
                      <Badge variant="info" className="text-[10px]">
                        Traitement · {videoState.model}
                      </Badge>
                    ) : null}
                  </div>
                  {videoState.phase === 'ready' ? (
                    <div className="space-y-1">
                      <Badge variant="success" className="text-[10px]">
                        Vidéo générée · {videoState.model}
                      </Badge>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video src={videoState.url} controls className="max-h-72 w-full rounded border" />
                    </div>
                  ) : null}
                  {videoState.phase === 'failed' ? (
                    <p className="text-xs text-rose-600">{videoState.error}</p>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Générateur d’image</Label>
                      <select
                        className="w-full rounded-md border px-3 py-2 text-sm sm:w-64"
                        value={visualProvider}
                        onChange={(e) => setVisualProvider(e.target.value as VisualProvider)}
                        disabled={busy !== null}
                      >
                        {VISUAL_PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button variant="outline" onClick={generateVisual} disabled={busy !== null}>
                      {busy === 'visual' ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ImagePlus className="mr-1 h-4 w-4" />
                      )}
                      {imageUrl ? 'Régénérer le visuel' : 'Générer le visuel'}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {VISUAL_PROVIDERS.find((p) => p.value === visualProvider)?.hint}
                  </p>
                  {isCarouselFormat ? (
                    <p className="text-[11px] italic text-muted-foreground">
                      Les slides du carrousel s’éditent dans le Studio (onglet Carrousel) après création.
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          {/* 4 · Adaptations */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">4 · Adapter aux autres réseaux (optionnel)</CardTitle>
              <CardDescription>
                L’IA réécrit ce texte pour chaque réseau coché — longueur, ton et codes adaptés.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {otherPlatforms.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-sky-600"
                      checked={adaptTargets.includes(p)}
                      onChange={(e) =>
                        setAdaptTargets((prev) =>
                          e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                        )
                      }
                    />
                    {p}
                  </label>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={generateAdaptations}
                disabled={busy !== null || adaptTargets.length === 0}
              >
                {busy === 'adapt' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="mr-1 h-4 w-4" />
                )}
                Générer les adaptations
              </Button>

              {adaptations.length > 0 ? (
                <div className="space-y-3">
                  {adaptations.map((v) => (
                    <div key={v.id} className="rounded-md border p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="info" className="text-[10px]">
                          {v.platform ?? v.label}
                        </Badge>
                        {v.mocked ? (
                          <Badge variant="outline" className="text-[10px]">
                            simulé
                          </Badge>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-slate-700">{v.body}</p>
                    </div>
                  ))}
                  {postId ? (
                    <a
                      className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline"
                      href={`/studio?postId=${postId}&tab=variantes&platform=${platform}`}
                    >
                      Ouvrir dans le Studio → Versions &amp; A/B <ArrowRight className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button variant="brand" size="lg" onClick={finish} disabled={busy !== null}>
              {busy === 'save' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Continuer vers la publication <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ====== APERÇU LIVE ====== */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                Aperçu
                <Badge variant="info" className="text-[10px]">
                  {platform}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border bg-white">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ background: brand?.profile?.primaryColor || '#6366f1' }}
                  >
                    {(brand?.name ?? 'M').charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-xs font-semibold text-slate-800">
                    {brand?.name ?? 'Votre marque'}
                  </span>
                </div>
                <div className="aspect-square w-full bg-slate-100">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="visuel" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-slate-400">
                      Pas encore de visuel
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="whitespace-pre-wrap text-[11px] text-slate-700">
                    {body || (
                      <span className="italic text-slate-400">Votre texte apparaîtra ici.</span>
                    )}
                  </p>
                  {tags.length > 0 ? (
                    <p className="text-[10px] font-medium text-sky-600">
                      {tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ComposerClient;
