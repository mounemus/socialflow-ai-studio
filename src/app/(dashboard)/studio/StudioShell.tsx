'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { platformFromFormat } from '@/lib/post-status';
import { PreviewRenderer } from '@/components/preview/PreviewRenderer';
import type { SupportFormat } from '@prisma/client';
import { TextStudio } from '../ai-studio/TextStudio';
import { ImageStudio } from '../ai-studio/ImageStudio';
import { CarouselEditor } from '@/components/studio/CarouselEditor';
import { AttachVisual } from '@/components/media/AttachVisual';
import { VideoEditor } from '@/components/studio/VideoEditor';
import {
  ClipboardList, Type, Image as ImageIcon, Palette, Eye, CheckCircle2, Send, ExternalLink,
  Layers, Clapperboard, GitCompare, RotateCcw,
} from 'lucide-react';

type TabId =
  | 'brief' | 'texte' | 'visuel' | 'carrousel' | 'reel' | 'canva'
  | 'variantes' | 'apercu' | 'validation' | 'diffusion';

const TABS: { id: TabId; label: string; icon: typeof Type }[] = [
  { id: 'brief', label: 'Brief', icon: ClipboardList },
  { id: 'texte', label: 'Texte', icon: Type },
  { id: 'visuel', label: 'Visuel', icon: ImageIcon },
  { id: 'carrousel', label: 'Carrousel', icon: Layers },
  { id: 'reel', label: 'Vidéo/Reel', icon: Clapperboard },
  { id: 'canva', label: 'Canva', icon: Palette },
  { id: 'variantes', label: 'Versions & A/B', icon: GitCompare },
  { id: 'apercu', label: 'Aperçu', icon: Eye },
  { id: 'validation', label: 'Validation', icon: CheckCircle2 },
  { id: 'diffusion', label: 'Diffusion', icon: Send },
];

// Contexte par format : quand un post est chargé, seuls les onglets
// pertinents pour son SupportFormat réel sont montrés (voir schema.prisma).
function isCarouselFormat(f: string | null | undefined): boolean {
  return !!f && f.includes('CAROUSEL');
}
const VIDEO_FORMATS = new Set([
  'INSTAGRAM_REEL', 'INSTAGRAM_STORY', 'FACEBOOK_STORY', 'TIKTOK_VIDEO',
  'YOUTUBE_SHORT', 'VIDEO_SCRIPT', 'STORYBOARD',
]);
function isVideoFormat(f: string | null | undefined): boolean {
  return !!f && VIDEO_FORMATS.has(f);
}
const EMAIL_FORMATS = new Set(['NEWSLETTER', 'EMAIL_MARKETING']);
function isEmailFormat(f: string | null | undefined): boolean {
  return !!f && EMAIL_FORMATS.has(f);
}
// Fallback du brief Canva sans post chargé : plateforme → son *_POST valide.
const PLATFORM_POST_FORMAT: Record<string, string> = {
  INSTAGRAM: 'INSTAGRAM_POST',
  FACEBOOK: 'FACEBOOK_POST',
  LINKEDIN: 'LINKEDIN_POST',
  TWITTER: 'TWITTER_POST',
  TIKTOK: 'TIKTOK_VIDEO',
  YOUTUBE: 'YOUTUBE_SHORT',
  PINTEREST: 'PINTEREST_PIN',
};

interface Brand {
  id: string;
  name: string;
  profile?: { toneOfVoice?: string | null; audienceTarget?: string | null; visualStyle?: string | null } | null;
}
interface PostRow {
  id: string;
  title: string | null;
  body: string | null;
  hashtags: string[];
  status: string;
  format: string;
  /** Plateforme résolue côté serveur (présente sur le post chargé par ID). */
  resolvedPlatform?: string | null;
  brand?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
  /** Présent uniquement sur le post chargé par ID (pas dans la liste). */
  media?: Array<{ id: string; url: string | null; type?: string | null }> | null;
}
interface AccountRow {
  id: string;
  platform: string;
  handle: string;
  status: string;
  _count?: { tokens: number };
}
interface ProviderEntry {
  id: string;
  label: string;
  available: boolean;
  mode: 'REAL' | 'SIMULATED' | 'UNAVAILABLE';
  reliabilityScore: number | null;
  observed: { requests7d: number; successRate: number | null; p50LatencyMs: number | null };
  estCostPerCallUsd: number | null;
}

const PROVIDER_MODE_BADGE: Record<ProviderEntry['mode'], 'success' | 'warning' | 'secondary'> = {
  REAL: 'success',
  SIMULATED: 'warning',
  UNAVAILABLE: 'secondary',
};

export function StudioShell({ defaultBrandId = null }: { defaultBrandId?: string | null } = {}) {
  const sp = useSearchParams();
  // ?tab= permet aux autres pages d'ouvrir l'atelier directement au bon
  // endroit (ex. « Programmer » après une génération → onglet Diffusion).
  const [tab, setTab] = useState<TabId>(() => {
    const t = sp.get('tab') as TabId | null;
    return t && TABS.some((x) => x.id === t) ? t : 'brief';
  });
  // Un ?tab= explicite dans l'URL désactive l'auto-sélection d'onglet au
  // chargement d'un post (ex. lien « Programmer » → onglet Diffusion précis).
  const [hadUrlTab] = useState(() => !!sp.get('tab'));
  // Langue du contenu vidéo (voix off, textes à l'écran) — fr par défaut.
  const [videoLanguage, setVideoLanguage] = useState('fr');
  // Onglets déjà visités — leurs composants restent montés pour préserver le
  // travail en cours (voir le commentaire au niveau du rendu des onglets).
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set<TabId>(['brief']));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);
  const [brands, setBrands] = useState<Brand[]>([]);
  // Priorité : query string (lien contextualisé) > marque active globale.
  const [brandId, setBrandId] = useState(sp.get('brandId') ?? defaultBrandId ?? '');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postId, setPostId] = useState(sp.get('postId') ?? '');
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [platform, setPlatform] = useState(sp.get('platform') ?? 'INSTAGRAM');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  // Publication ouverte depuis un pipeline : lien de retour direct à l'Acte 4.
  const fromPipelineId = sp.get('pipelineId');
  // Canva
  const [canvaBrief, setCanvaBrief] = useState('');
  const [canvaLoading, setCanvaLoading] = useState(false);
  // Carrousel / Reel
  const [carouselTopic, setCarouselTopic] = useState('');
  const [carouselSlides, setCarouselSlides] = useState(5);
  const [carouselResult, setCarouselResult] = useState<{ text: string; mocked: boolean } | null>(null);
  const [reelTopic, setReelTopic] = useState('');
  const [reelResult, setReelResult] = useState<{ text: string; mocked: boolean } | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [videoState, setVideoState] = useState<
    | { phase: 'idle' }
    | { phase: 'processing'; predictionId: string; model: string }
    | { phase: 'ready'; url: string; model: string }
    | { phase: 'failed'; error: string }
  >({ phase: 'idle' });
  // Versions & variantes
  const [versions, setVersions] = useState<{ id: string; version: number; body: string | null; note: string | null; createdAt: string }[]>([]);
  const [variants, setVariants] = useState<{ id: string; label: string; body: string | null; platform: string | null; provider: string | null; mocked: boolean }[]>([]);
  // Validation / diffusion
  const [approvalMessage, setApprovalMessage] = useState('');
  const [scheduleAccountId, setScheduleAccountId] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);

  // `.catch(() => null)` sur chaque requête : avant, un simple échec réseau sur
  // UN SEUL des quatre appels (fetch() rejeté, pas juste un statut non-2xx)
  // faisait échouer tout le Promise.all SANS catch — plus aucun `set...` ne
  // s'exécutait. Marques (→ « Aucune marque sélectionnée » malgré la marque
  // active côté serveur) et fournisseurs (→ page suivante) restaient vides
  // pour toujours, silencieusement.
  const loadAll = useCallback(async () => {
    const safe = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    const [b, p, a] = await Promise.all([
      safe('/api/brands'),
      safe('/api/posts'),
      safe('/api/social/accounts'),
    ]);
    if (b?.data) setBrands(b.data as Brand[]);
    if (p?.data) setPosts(p.data as PostRow[]);
    if (a?.data) setAccounts(a.data as AccountRow[]);
  }, []);
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Registre fournisseurs IA chargé à part (voir carte Brief) : un statut
  // explicite loading/ready/error remplace l'ancienne déduction implicite
  // « providers.length === 0 → chargement », qui restait bloquée sur
  // « Chargement du registre… » pour toujours en cas d'échec, sans erreur ni
  // moyen de relancer.
  const [providersStatus, setProvidersStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadProviders = useCallback(async () => {
    setProvidersStatus('loading');
    try {
      const res = await fetch('/api/ai/providers');
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = await res.json();
      setProviders((json?.data?.providers ?? []) as ProviderEntry[]);
      setProvidersStatus('ready');
    } catch {
      setProvidersStatus('error');
    }
  }, []);
  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const brand = useMemo(() => brands.find((b) => b.id === brandId) ?? null, [brands, brandId]);
  // Publication ouverte depuis la Production/le Calendrier : elle n'est pas
  // forcément dans la liste (bornée à 100, toutes marques confondues) — sans ce
  // chargement direct, l'Atelier s'ouvrait VIDE sur un post pourtant existant.
  const [directPost, setDirectPost] = useState<PostRow | null>(null);
  useEffect(() => {
    if (!postId) {
      setDirectPost(null);
      return;
    }
    if (posts.some((p) => p.id === postId)) return;
    fetch(`/api/posts/${postId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDirectPost((d?.data ?? null) as PostRow | null))
      .catch(() => {});
  }, [postId, posts]);

  const post = useMemo(
    () => posts.find((p) => p.id === postId) ?? (directPost?.id === postId ? directPost : null),
    [posts, postId, directPost],
  );
  // Sans `?platform=` dans l'URL, la plateforme est dérivée du post ouvert
  // (format → plateforme) : tous les onglets (Texte, Visuel, Canva, Aperçu)
  // travaillent alors sur le bon réseau au lieu du défaut INSTAGRAM. Une seule
  // fois par post, pour ne pas écraser un choix manuel fait dans le Brief.
  const platformDerivedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!post || sp.get('platform') || platformDerivedFor.current === post.id) return;
    const derived = post.resolvedPlatform ?? platformFromFormat(post.format);
    if (!derived) return;
    platformDerivedFor.current = post.id;
    setPlatform(derived);
  }, [post, sp]);

  // Objectif/Audience : saisis UNE fois, persistés sur post.metadata et
  // rechargés à l'ouverture — avant, ces champs du Brief étaient volatils
  // (perdus au rechargement) et jamais transmis aux onglets Texte/Visuel.
  const briefSeededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!post || briefSeededFor.current === post.id) return;
    briefSeededFor.current = post.id;
    const meta = (post.metadata as Record<string, unknown> | null) ?? {};
    if (typeof meta.objective === 'string' && meta.objective) setObjective(meta.objective);
    if (typeof meta.audience === 'string' && meta.audience) setAudience(meta.audience);
  }, [post]);
  const saveBriefContext = useCallback(async () => {
    if (!postId) return;
    await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { objective, audience } }),
    }).catch(() => {});
  }, [postId, objective, audience]);

  // Onglets pertinents pour le format du post chargé — sans post, tout reste
  // visible (comportement inchangé). Carrousel/Reel n'apparaissent que pour
  // leur format ; Canva disparaît pour les formats vidéo et email.
  const visibleTabIds = useMemo<TabId[]>(() => {
    if (!post) return TABS.map((t) => t.id);
    return TABS.filter((t) => {
      if (t.id === 'carrousel') return isCarouselFormat(post.format);
      if (t.id === 'reel') return isVideoFormat(post.format);
      if (t.id === 'canva') return !isVideoFormat(post.format) && !isEmailFormat(post.format);
      return true;
    }).map((t) => t.id);
  }, [post]);
  useEffect(() => {
    if (!visibleTabIds.includes(tab)) setTab('texte');
  }, [visibleTabIds, tab]);

  // Auto-ouverture de l'onglet adapté au format, une seule fois par post, et
  // seulement si l'URL n'imposait pas déjà un onglet précis.
  const autoTabDerivedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!post || hadUrlTab || autoTabDerivedFor.current === post.id) return;
    autoTabDerivedFor.current = post.id;
    if (isCarouselFormat(post.format)) setTab('carrousel');
    else if (isVideoFormat(post.format)) setTab('reel');
    // Tout autre format (post LinkedIn/Instagram/Facebook, email…) : ouvrir
    // l'onglet Texte, qui charge le contenu du post. Rester sur « Brief »
    // donnait l'impression que « Ouvrir dans le Studio » n'avait rien récupéré
    // (le Brief n'affiche pas la publication de travail).
    else setTab('texte');
  }, [post, hadUrlTab]);

  const brandPosts = useMemo(
    () => (brandId ? posts.filter((p) => p.brand?.id === brandId) : posts),
    [posts, brandId],
  );

  /**
   * Recharge la publication de travail COMPLÈTE (avec ses médias) et la
   * réinjecte dans la liste. Après « Utiliser pour ce post », l'Aperçu montrait
   * encore l'ancien visuel : la liste `/api/posts` ne contient pas `media`, et
   * seuls les versions/variantes étaient rechargées.
   */
  const refreshWorkingPost = useCallback(async () => {
    if (!postId) return;
    const fresh = await fetch(`/api/posts/${postId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const p = fresh?.data as PostRow | undefined;
    if (!p?.id) return;
    setPosts((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    setDirectPost(p);
  }, [postId]);

  const loadPostArtifacts = useCallback(async (pid: string) => {
    if (!pid) {
      setVersions([]);
      setVariants([]);
      return;
    }
    const [v, va] = await Promise.all([
      fetch(`/api/posts/${pid}/versions`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/posts/${pid}/variants`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setVersions(v?.data ?? []);
    setVariants(va?.data ?? []);
  }, []);
  useEffect(() => {
    loadPostArtifacts(postId);
  }, [postId, loadPostArtifacts]);

  // Robustesse : si le post ciblé par ?postId= n'est pas dans la liste chargée
  // (marque active différente, ou au-delà de la limite de 100 posts), on le
  // charge directement par ID. Sans ça, l'atelier ouvert depuis le calendrier /
  // une publication s'affichait VIDE (ni texte validé ni visuel). On aligne
  // aussi la marque active sur celle du post pour un contexte cohérent.
  useEffect(() => {
    if (!postId) return;
    // On (re)charge le post complet par ID tant qu'on n'a pas encore ses médias
    // (la liste /api/posts n'inclut pas `media` → l'aperçu restait sans visuel).
    const existing = posts.find((p) => p.id === postId);
    if (existing && Array.isArray(existing.media)) return;
    let cancelled = false;
    fetch(`/api/posts/${postId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const p = j?.data as (PostRow & { brand?: { id?: string } }) | undefined;
        if (cancelled || !p?.id) return;
        // Remplace le stub de liste par le post complet (avec médias).
        setPosts((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
        if (p.brand?.id) setBrandId(p.brand.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [postId, posts]);

  async function generateStructured(kind: 'carousel' | 'reel') {
    const topic = kind === 'carousel' ? carouselTopic : reelTopic;
    if (!topic.trim()) return toast.error('Décris le sujet d’abord.');
    setGenLoading(true);
    try {
      const prompt =
        kind === 'carousel'
          ? `Crée un carrousel ${platform} de ${carouselSlides} slides sur : ${topic}.\n` +
            `Pour chaque slide: "Slide N — titre court" puis 1-2 lignes de texte. ` +
            `Slide 1 = accroche forte, dernière slide = CTA.${objective ? ` Objectif: ${objective}.` : ''}`
          : `Écris un script de Reel/vidéo courte (30-45s) sur : ${topic}.\n` +
            `Structure: HOOK (3s), 3-4 séquences avec indication visuelle + voix off, CTA final.` +
            `${objective ? ` Objectif: ${objective}.` : ''}${audience ? ` Audience: ${audience}.` : ''}`;
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: brandId || undefined,
          platform,
          format:
            kind === 'carousel'
              ? (post && isCarouselFormat(post.format) ? post.format : 'INSTAGRAM_CAROUSEL')
              : (post && isVideoFormat(post.format) ? post.format : 'INSTAGRAM_REEL'),
          prompt,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Génération impossible');
      const out = { text: json.data?.text ?? '', mocked: !!json.data?.mocked };
      if (kind === 'carousel') setCarouselResult(out);
      else setReelResult(out);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGenLoading(false);
    }
  }

  // Génération vidéo RÉELLE (Replicate, asynchrone) — jamais de fausse vidéo.
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
        // Rattache la vidéo à la publication de travail : elle devient montable
        // (découpe + sous-titres) dans l'éditeur juste au-dessus.
        if (postId && data.mediaId) {
          const attached = await fetch(`/api/posts/${postId}/media`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mediaId: data.mediaId, replace: false }),
          }).then((r) => r.ok).catch(() => false);
          if (attached) await refreshWorkingPost();
          toast.success(attached
            ? 'Vidéo générée et attachée à la publication — montable ci-dessus.'
            : 'Vidéo générée et ajoutée à la médiathèque.');
        } else {
          toast.success('Vidéo générée et ajoutée à la médiathèque.');
        }
      } else if (data.status === 'FAILED') {
        setVideoState({ phase: 'failed', error: data.error });
        toast.error(`Vidéo: ${data.error}`.slice(0, 120));
      }
    }, 5000);
    return () => clearInterval(t);
  }, [videoState, brandId, postId, refreshWorkingPost]);

  async function generateVideo() {
    if (!reelTopic.trim() && !reelResult) return toast.error('Génère d’abord le script (ou décris le sujet).');
    try {
      const res = await fetch('/api/ai/generate-video', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: reelResult
            ? `Short vertical social video. ${reelTopic}. Script: ${reelResult.text.slice(0, 800)}`
            : reelTopic,
          brandId: brandId || undefined,
          aspectRatio: '9:16',
          language: videoLanguage,
        }),
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
      toast.error((err as Error).message);
    }
  }

  async function generateVariants(mode: 'ab' | 'platforms') {
    if (!postId) return toast.error('Sélectionne d’abord une publication.');
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/variants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'ab' ? { count: 2 } : { platforms: ['INSTAGRAM', 'LINKEDIN', 'FACEBOOK'] },
        ),
      });
      if (!res.ok) throw new Error('Génération des variantes impossible');
      toast.success('Variantes générées.');
      loadPostArtifacts(postId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyVariant(variantId: string, label: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/variants/${variantId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Application impossible');
      toast.success(`Variante ${label} appliquée (l’ancienne version est conservée).`);
      loadAll();
      loadPostArtifacts(postId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restoreVersion(version: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) throw new Error('Restauration impossible');
      toast.success(`Version ${version} restaurée.`);
      loadAll();
      loadPostArtifacts(postId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generateCanvaBrief() {
    if (!brandId) return toast.error('Choisis d’abord une marque dans l’onglet Brief.');
    setCanvaLoading(true);
    try {
      const res = await fetch('/api/ai/generate-brief-canva', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId,
          topic: objective || post?.title || 'Publication sociale',
          format: post ? post.format : (PLATFORM_POST_FORMAT[platform] ?? 'INSTAGRAM_POST'),
          audience: audience || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Erreur');
      setCanvaBrief(json.data?.brief ?? json.data ?? '');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCanvaLoading(false);
    }
  }

  async function requestApproval() {
    if (!postId) return toast.error('Sélectionne d’abord une publication.');
    setBusy(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, message: approvalMessage || undefined }),
      });
      if (!res.ok) throw new Error('Demande de validation impossible');
      toast.success('Validation demandée — visible dans Validations (menu latéral) et en Production.');
      loadAll();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function schedulePost() {
    if (!postId) return toast.error('Sélectionne d’abord une publication.');
    if (!scheduleAccountId || !scheduleAt) return toast.error('Compte et date requis.');
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          socialAccountId: scheduleAccountId,
          scheduledFor: new Date(scheduleAt).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Programmation impossible');
      toast.success('Publication programmée — suivi dans le calendrier.');
      loadAll();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Atelier créatif</h1>
          <p className="text-sm text-muted-foreground">
            Brief → Texte → Visuel → Canva → Aperçu → Validation → Diffusion, avec le contexte de la marque.
          </p>
        </div>
        {brand ? <Badge variant="secondary">Marque : {brand.name}</Badge> : null}
      </div>

      {/* Enchaînement « Orbit » : le contexte de marque est TOUJOURS visible.
          Avec une marque → confirmation que sa voix est appliquée + lien vers
          la stratégie. Sans marque → la prochaine action utile. */}
      {brand ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-500/30 bg-brand-50 px-4 py-2.5 text-sm">
          <div className="text-foreground">
            <span className="font-semibold">Contexte de {brand.name} activé</span>
            <span className="text-muted-foreground"> — voix, audience et piliers appliqués automatiquement.</span>
          </div>
          <Link
            href={`/brands/${brand.id}/strategy`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Voir la stratégie →
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-secondary/60 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Aucune marque sélectionnée — choisissez-en une dans l&apos;onglet Brief pour créer avec sa voix.
          </span>
          {brands.length === 0 ? (
            <Link href="/brands/new" className="text-xs font-medium text-brand-700 hover:underline">
              Créer ma première marque →
            </Link>
          ) : null}
        </div>
      )}

      {/* Retour au pipeline d'origine — parcours aller-retour sans impasse. */}
      {fromPipelineId && post ? (
        <div className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm">
          <span className="text-violet-900">
            Publication du pipeline — vos modifications ici seront reflétées à l&apos;Acte 4.
          </span>
          <Link
            href={`/pipelines/${fromPipelineId}`}
            className="shrink-0 text-xs font-medium text-violet-700 hover:underline"
          >
            ← Retour au pipeline (Acte 4)
          </Link>
        </div>
      ) : null}

      {/* Onglets */}
      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {TABS.filter((t) => visibleTabIds.includes(t.id)).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'brief' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contexte de création</CardTitle>
              <CardDescription>
                Ce contexte est repris par les onglets Texte, Visuel et Canva.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs font-medium">Marque</label>
                <select className={selectClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  <option value="">— Choisir une marque —</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Plateforme cible</label>
                <select className={selectClass} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TIKTOK', 'TWITTER', 'YOUTUBE', 'PINTEREST'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Objectif</label>
                <input className={selectClass} placeholder="Ex: faire connaître la nouvelle collection" value={objective} onChange={(e) => setObjective(e.target.value)} onBlur={saveBriefContext} />
              </div>
              <div>
                <label className="text-xs font-medium">Audience</label>
                <input className={selectClass} placeholder="Ex: jeunes créateurs 18-30, francophones" value={audience} onChange={(e) => setAudience(e.target.value)} onBlur={saveBriefContext} />
              </div>
              {brand?.profile ? (
                <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                  <div className="font-medium text-slate-800">Brand DNA injecté</div>
                  {brand.profile.toneOfVoice ? <div>Ton : {brand.profile.toneOfVoice}</div> : null}
                  {brand.profile.audienceTarget ? <div>Audience : {brand.profile.audienceTarget}</div> : null}
                  {brand.profile.visualStyle ? <div>Style visuel : {brand.profile.visualStyle}</div> : null}
                  {!brand.profile.toneOfVoice && !brand.profile.audienceTarget ? (
                    <div>
                      Profil incomplet — <Link className="text-brand-600 hover:underline" href={`/brands/${brand.id}`}>compléter le Brand DNA →</Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fournisseurs IA — capacités réelles</CardTitle>
              <CardDescription>
                Disponibilité, fiabilité observée (7 j) et coût estimé. Un fournisseur « simulation » ne
                produit pas de contenu réel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {providers.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.label}</span>
                      <Badge variant={PROVIDER_MODE_BADGE[p.mode]}>
                        {p.mode === 'REAL' ? 'réel' : p.mode === 'SIMULATED' ? 'simulation' : 'indisponible'}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {p.observed.requests7d > 0 ? (
                        <>
                          {Math.round((p.observed.successRate ?? 0) * 100)}% succès · p50{' '}
                          {p.observed.p50LatencyMs}ms
                        </>
                      ) : (
                        'pas encore de données'
                      )}
                      {p.estCostPerCallUsd != null ? ` · ~$${p.estCostPerCallUsd}/appel` : ''}
                    </div>
                  </div>
                ))}
                {providersStatus === 'loading' && providers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Chargement du registre…</p>
                ) : null}
                {providersStatus === 'error' ? (
                  <div className="flex items-center justify-between gap-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                    <span>Registre indisponible.</span>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={loadProviders}>
                      Réessayer
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Le contexte défini dans l'onglet Brief est transmis aux étapes
          suivantes : sans ces props, chaque onglet repartait de « sans marque »
          alors que l'en-tête affichait la marque choisie.

          Montage persistant : un onglet déjà visité reste MONTÉ (masqué en
          CSS) au lieu d'être détruit. Avant, changer d'onglet démontait
          TextStudio/ImageStudio et anéantissait tout le travail en cours —
          texte généré, prompt rédigé, images produites. On ne monte pas tout
          d'avance (chaque studio charge ses données) : seulement ce qui a
          servi. */}
      {visitedTabs.has('texte') ? (
        <div className={tab === 'texte' ? undefined : 'hidden'}>
          {/* `postId` : les onglets travaillent sur la MÊME publication que
              l'onglet Aperçu/Diffusion — sinon le travail fait ici n'était
              rattaché à rien et semblait « perdu » d'une étape à l'autre. */}
          <TextStudio
            key={postId || 'new'}
            initialBrandId={brandId}
            initialPlatform={platform}
            initialPostId={postId || undefined}
            initialObjective={objective || undefined}
            initialAudience={audience || undefined}
            onRequestVisual={() => setTab('visuel')}
          />
        </div>
      ) : null}
      {visitedTabs.has('visuel') ? (
        <div className={tab === 'visuel' ? undefined : 'hidden'}>
          <ImageStudio
            initialBrandId={brandId}
            postId={postId || undefined}
            onAttached={refreshWorkingPost}
          />
          {post ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Joindre un visuel existant</CardTitle>
              </CardHeader>
              <CardContent>
                <AttachVisual
                  postId={post.id}
                  brandId={brandId}
                  replace={false}
                  onAttached={() => refreshWorkingPost()}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === 'carrousel' && visibleTabIds.includes('carrousel') && post ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Éditeur de slides</CardTitle>
            <CardDescription>
              Réordonne (glisser-déposer ou flèches), édite le texte de chaque slide, ajoute ou retire des visuels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CarouselEditor
              postId={post.id}
              brandId={brandId}
              media={(post.media ?? [])
                .filter((m) => !!m.url)
                .map((m) => ({ id: m.id, url: m.url as string, type: m.type ?? undefined }))}
              metadata={(post.metadata as Record<string, unknown> | null) ?? null}
              onChanged={refreshWorkingPost}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === 'carrousel' && visibleTabIds.includes('carrousel') ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Carrousel — structure IA</CardTitle>
            <CardDescription>Plan slide par slide, accroche en tête et CTA en dernière slide.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <input className={selectClass} placeholder="Sujet du carrousel" value={carouselTopic} onChange={(e) => setCarouselTopic(e.target.value)} />
              <select className="w-28 rounded-md border bg-background px-2 py-2 text-sm" value={carouselSlides} onChange={(e) => setCarouselSlides(Number(e.target.value))}>
                {[3, 4, 5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n} slides</option>)}
              </select>
            </div>
            <Button size="sm" variant="brand" onClick={() => generateStructured('carousel')} disabled={genLoading}>
              {genLoading ? 'Génération…' : 'Générer le carrousel'}
            </Button>
            {carouselResult ? (
              <div className="space-y-1">
                {carouselResult.mocked ? <Badge variant="warning">simulation — pas d’IA réelle</Badge> : null}
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border bg-slate-50 p-2 text-xs">{carouselResult.text}</pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'reel' && visibleTabIds.includes('reel') && post ? (() => {
        const postVideoUrl = (post.media ?? []).find((m) => (m.type ?? '').toUpperCase().includes('VIDEO'))?.url ?? null;
        return postVideoUrl ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Montage vidéo</CardTitle>
              <CardDescription>
                Découpe la vidéo attachée, pose des sous-titres avec aperçu en direct, exporte en .srt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VideoEditor
                postId={post.id}
                brandId={brandId}
                videoUrl={postVideoUrl}
                metadata={(post.metadata as Record<string, unknown> | null) ?? null}
                onChanged={refreshWorkingPost}
              />
            </CardContent>
          </Card>
        ) : (
          <p className="rounded-lg border border-dashed bg-card px-4 py-3 text-xs text-muted-foreground">
            Aucune vidéo attachée à cette publication — génère-en une ci-dessous, elle deviendra montable ici.
          </p>
        );
      })() : null}

      {tab === 'reel' && visibleTabIds.includes('reel') ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vidéo / Reel</CardTitle>
            <CardDescription>Script 30-45 s : hook, séquences visuelles + voix off, CTA.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <input className={selectClass} placeholder="Sujet du Reel" value={reelTopic} onChange={(e) => setReelTopic(e.target.value)} />
            <Button size="sm" variant="brand" onClick={() => generateStructured('reel')} disabled={genLoading}>
              {genLoading ? 'Génération…' : 'Générer le script'}
            </Button>
            {reelResult ? (
              <div className="space-y-1">
                {reelResult.mocked ? <Badge variant="warning">simulation — pas d’IA réelle</Badge> : null}
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border bg-slate-50 p-2 text-xs">{reelResult.text}</pre>
              </div>
            ) : null}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={generateVideo} disabled={videoState.phase === 'processing'}>
                  <Clapperboard className="mr-1 h-3 w-3" />
                  {videoState.phase === 'processing' ? 'Génération en cours…' : 'Générer la vidéo (fal.ai / Replicate)'}
                </Button>
                <select
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                  value={videoLanguage}
                  onChange={(e) => setVideoLanguage(e.target.value)}
                  title="Langue de la voix off et des textes à l'écran"
                >
                  <option value="fr">Contenu : Français</option>
                  <option value="en">Contenu : English</option>
                </select>
                {videoState.phase === 'processing' ? (
                  <Badge variant="info">PROCESSING · {videoState.model}</Badge>
                ) : null}
              </div>
              {videoState.phase === 'ready' ? (
                <div className="space-y-1">
                  <Badge variant="success">Vidéo réelle · {videoState.model}</Badge>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={videoState.url} controls className="max-h-72 rounded border" />
                </div>
              ) : null}
              {videoState.phase === 'failed' ? (
                <p className="text-xs text-rose-600">{videoState.error}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Modèle configurable dans Paramètres → Modèles IA. fal.ai est utilisé
                par défaut, Replicate en secours automatique (l&apos;ordre s&apos;inverse si tu
                forces Replicate dans les réglages). Sans aucune clé configurée,
                l&apos;indisponibilité est affichée telle quelle — aucune vidéo simulée.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'canva' && visibleTabIds.includes('canva') ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brief Canva contextualisé</CardTitle>
              <CardDescription>
                Génère un brief prêt à coller dans Canva à partir du contexte du Brief.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button size="sm" variant="brand" onClick={generateCanvaBrief} disabled={canvaLoading}>
                {canvaLoading ? 'Génération…' : 'Générer le brief'}
              </Button>
              {canvaBrief ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-slate-50 p-2 text-xs">{canvaBrief}</pre>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modes Canva</CardTitle>
              <CardDescription>
                Le mode réellement utilisé est toujours affiché : API (création réelle), HANDOFF
                (ouverture dans Canva puis retour), ou fallback manuel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link href="/canva-studio">
                <Button variant="outline" size="sm">
                  Ouvrir Canva Studio <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </Link>
              <p className="text-xs text-muted-foreground">
                La création automatique depuis un Brand Template (mode API) nécessite les scopes
                enterprise Canva + un brand_template_id — statut visible dans Connexions.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {(tab === 'variantes' || tab === 'apercu' || tab === 'validation' || tab === 'diffusion') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publication de travail</CardTitle>
          </CardHeader>
          <CardContent>
            <select className={selectClass} value={postId} onChange={(e) => setPostId(e.target.value)}>
              <option value="">— Choisir une publication —</option>
              {brandPosts.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.status}] {p.title ?? p.body?.slice(0, 60) ?? p.format}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {tab === 'variantes' && postId ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Variantes A/B & par réseau</CardTitle>
              <CardDescription>
                Compare, puis applique — l’état actuel est toujours archivé avant écrasement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Button size="sm" variant="brand" onClick={() => generateVariants('ab')} disabled={busy}>
                  Générer A/B
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateVariants('platforms')} disabled={busy}>
                  Variantes IG + LinkedIn + FB
                </Button>
              </div>
              {variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucune variante pour cette publication.</p>
              ) : (
                <div className="space-y-2">
                  {variants.map((v) => (
                    <div key={v.id} className="rounded border p-2">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="secondary">{v.platform ?? `Variante ${v.label}`}</Badge>
                        {v.provider ? (
                          <Badge variant={v.mocked ? 'warning' : 'info'}>
                            {v.mocked ? 'simulation' : v.provider}
                          </Badge>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 px-2 text-xs"
                          onClick={() => applyVariant(v.id, v.label)}
                          disabled={busy}
                        >
                          Appliquer
                        </Button>
                      </div>
                      <p className="max-h-28 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
                        {v.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historique des versions</CardTitle>
              <CardDescription>Chaque modification de contenu crée un instantané restaurable.</CardDescription>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Pas encore d’historique — il se remplit à la prochaine modification.
                </p>
              ) : (
                <ul className="space-y-2">
                  {versions.map((v) => (
                    <li key={v.id} className="rounded border p-2">
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <Badge variant="secondary">v{v.version}</Badge>
                        <span className="text-muted-foreground">
                          {v.note ?? 'edit'} · {new Date(v.createdAt).toLocaleString('fr-FR')}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 px-2 text-xs"
                          onClick={() => restoreVersion(v.version)}
                          disabled={busy}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" /> Restaurer
                        </Button>
                      </div>
                      <p className="max-h-20 overflow-auto whitespace-pre-wrap text-xs text-slate-500">
                        {(v.body ?? '').slice(0, 260)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'apercu' && post ? (() => {
        // Aperçu format-exact via PreviewRenderer. Même règle de cover que la
        // publication (src/lib/post-media.ts) : coverMediaId désigné, sinon
        // coverUrl/coverImageUrl explicite, sinon le média le plus récent —
        // placé en tête pour les formats à image unique (pas pour le carrousel,
        // où l'ordre des médias EST l'ordre des slides).
        const meta = (post.metadata ?? null) as Record<string, unknown> | null;
        const medias = (post.media ?? []).filter((m) => (m?.url ?? '').length > 0);
        const videoMedia = medias.find((m) => (m.type ?? '').toUpperCase().includes('VIDEO'));
        const imageMedias = medias.filter((m) => m !== videoMedia);
        let imageUrls = imageMedias.map((m) => m.url as string);
        if (!isCarouselFormat(post.format)) {
          const coverMediaId = typeof meta?.coverMediaId === 'string' ? meta.coverMediaId : null;
          const coverUrl =
            (coverMediaId ? imageMedias.find((m) => m.id === coverMediaId)?.url : null) ||
            (typeof meta?.coverUrl === 'string' && meta.coverUrl) ||
            (typeof meta?.coverImageUrl === 'string' && meta.coverImageUrl) ||
            imageMedias[imageMedias.length - 1]?.url ||
            '';
          if (coverUrl) imageUrls = [coverUrl, ...imageUrls.filter((u) => u !== coverUrl)];
        }
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Aperçu {post.format.replace(/_/g, ' ')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PreviewRenderer
                format={post.format as SupportFormat}
                brand={{ name: brand?.name ?? post.brand?.name ?? 'Marque' }}
                caption={post.body ?? undefined}
                hashtags={post.hashtags}
                imageUrls={imageUrls}
                videoUrl={videoMedia?.url ?? undefined}
                emailSubject={post.title ?? undefined}
                emailBody={post.body ?? undefined}
              />
            </CardContent>
          </Card>
        );
      })() : null}

      {tab === 'validation' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Demander une validation</CardTitle>
            <CardDescription>
              La publication passe « En validation » et apparaît dans Validations et en Production.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              className={selectClass}
              rows={2}
              placeholder="Message pour le relecteur (optionnel)"
              value={approvalMessage}
              onChange={(e) => setApprovalMessage(e.target.value)}
            />
            <Button size="sm" variant="brand" onClick={requestApproval} disabled={busy || !postId}>
              Demander la validation
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'diffusion' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Programmer la diffusion</CardTitle>
            <CardDescription>
              Le statut passe « Publié » uniquement si le réseau confirme — sinon « Publié
              (simulation) », « Échec » ou « Action requise ». Jamais de faux succès.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <label className="text-xs font-medium">Compte social</label>
              <select className={selectClass} value={scheduleAccountId} onChange={(e) => setScheduleAccountId(e.target.value)}>
                <option value="">— Choisir un compte —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} · @{a.handle} ({a.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Date et heure</label>
              <input type="datetime-local" className={selectClass} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="brand" onClick={schedulePost} disabled={busy || !postId}>
                Programmer
              </Button>
              {postId ? (
                <Link href={`/posts/${postId}`}>
                  <Button size="sm" variant="outline">Ouvrir la publication</Button>
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
