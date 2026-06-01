'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, Download, ImagePlus, Wand2, ExternalLink,
  Copy, Check, Layers, FileText, Palette, Calendar, Send,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DesignEditor } from '@/components/design/DesignEditor';

interface Brand { id: string; name: string }

type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';
type Provider = 'auto' | 'gemini' | 'dalle' | 'flux';

interface FormatDef {
  key: string;
  label: string;
  aspect: AspectRatio;
  canva: string; // canva.com create slug
  icon: string;
}

const FORMATS: FormatDef[] = [
  { key: 'ig_post', label: 'Post Instagram', aspect: '1:1', canva: 'instagram-posts', icon: '📷' },
  { key: 'ig_portrait', label: 'Post portrait (4:5)', aspect: '4:5', canva: 'instagram-posts', icon: '🖼️' },
  { key: 'ig_story', label: 'Story / Reel', aspect: '9:16', canva: 'instagram-stories', icon: '📱' },
  { key: 'fb_post', label: 'Post Facebook', aspect: '16:9', canva: 'facebook-posts', icon: '👍' },
  { key: 'li_post', label: 'Post LinkedIn', aspect: '1:1', canva: 'linkedin-posts', icon: '💼' },
  { key: 'tw_post', label: 'Post Twitter / X', aspect: '16:9', canva: 'twitter-posts', icon: '🐦' },
  { key: 'tiktok', label: 'TikTok', aspect: '9:16', canva: 'tiktok-videos', icon: '🎵' },
  { key: 'yt_thumb', label: 'Miniature YouTube', aspect: '16:9', canva: 'youtube-thumbnails', icon: '▶️' },
  { key: 'pin', label: 'Épingle Pinterest', aspect: '9:16', canva: 'pinterest-pins', icon: '📌' },
  { key: 'ad', label: 'Visuel publicitaire', aspect: '1:1', canva: 'ads', icon: '🎯' },
];

const STYLES = [
  { value: '', label: 'Libre' },
  { value: 'photorealistic, high detail, professional photography', label: 'Photo' },
  { value: 'minimal, clean, editorial design, lots of negative space', label: 'Minimal' },
  { value: 'vibrant colors, bold, energetic', label: 'Vif' },
  { value: 'cinematic lighting, moody atmosphere', label: 'Cinéma' },
  { value: 'flat design, illustration, vector style', label: 'Illustration' },
  { value: '3d render, smooth surfaces, soft studio lighting', label: '3D' },
  { value: 'studio shot, white background, product photography', label: 'Produit' },
];

const PROVIDERS: { value: Provider; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Le routeur choisit le meilleur provider disponible' },
  { value: 'gemini', label: 'Gemini', hint: 'Google Nano Banana — rapide, créatif' },
  { value: 'dalle', label: 'OpenAI', hint: 'gpt-image-1 — excellent pour texte dans l\'image' },
  { value: 'flux', label: 'FLUX', hint: 'Replicate — photoréalisme' },
];

interface GenImage { ok: boolean; url?: string; provider?: string; mocked?: boolean; mediaId?: string; error?: string }

export function DesignStudioClient() {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [formatKey, setFormatKey] = useState('ig_post');
  const [subject, setSubject] = useState('');
  const [style, setStyle] = useState('');
  const [provider, setProvider] = useState<Provider>('auto');
  const [variants, setVariants] = useState(2);

  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<GenImage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [brief, setBrief] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [savingPost, setSavingPost] = useState(false);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [canvaLoading, setCanvaLoading] = useState(false);
  const [canvaDesigns, setCanvaDesigns] = useState<{ id: string; title: string; url: string; previewUrl?: string; source?: string }[]>([]);
  const [canvaApiEnabled, setCanvaApiEnabled] = useState(true);
  // AI prompt suggestions (strategy + DNA aware)
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // attach own image
  const [attachUrl, setAttachUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  // direct share after post creation
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; platform: string }[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);

  const format = useMemo(() => FORMATS.find((f) => f.key === formatKey) ?? FORMATS[0], [formatKey]);

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => {
      const list = (d.data ?? []) as Brand[];
      setBrands(list);
      if (list[0]) setBrandId(list[0].id);
    });
    fetch('/api/social/accounts').then((r) => r.json()).then((d) => {
      const list = (d.data ?? []) as { id: string; platform: string; status?: string }[];
      setAccounts(list.filter((a) => (a.status ?? 'CONNECTED') === 'CONNECTED').map((a) => ({ id: a.id, platform: a.platform })));
    }).catch(() => {});
  }, []);

  const platformOfFormat = useMemo(() => {
    const k = formatKey;
    if (k.startsWith('ig') || k === 'pin') return k === 'pin' ? 'PINTEREST' : 'INSTAGRAM';
    if (k === 'fb_post') return 'FACEBOOK';
    if (k === 'li_post') return 'LINKEDIN';
    if (k === 'tw_post') return 'TWITTER';
    if (k === 'tiktok') return 'TIKTOK';
    if (k === 'yt_thumb') return 'YOUTUBE';
    return 'INSTAGRAM';
  }, [formatKey]);

  const matchingAccount = useMemo(
    () => accounts.find((a) => a.platform === platformOfFormat) ?? null,
    [accounts, platformOfFormat],
  );

  async function generate() {
    if (subject.trim().length < 3) return toast.error('Décris ce que tu veux créer (au moins 3 caractères)');
    setLoading(true);
    setImages([]);
    setSelected(null);
    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: subject,
          aspectRatio: format.aspect,
          styleHint: style || undefined,
          variants,
          brandId: brandId || undefined,
          provider,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j?.message ?? 'Génération échouée');
        return;
      }
      const imgs: GenImage[] = j.data?.images ?? [];
      const ok = imgs.filter((i) => i.ok && i.url);
      setImages(imgs);
      if (ok[0]?.url) setSelected(ok[0].url);
      if (ok.length === 0) {
        toast.error('Aucun visuel généré — vérifie que les clés API images (Replicate/OpenAI/Gemini) sont configurées.');
      } else if (ok.some((i) => i.mocked)) {
        toast.warning('Visuel mock (provider indisponible). Configure une clé image dans Admin.');
      } else {
        toast.success(`${ok.length} visuel${ok.length > 1 ? 's' : ''} généré${ok.length > 1 ? 's' : ''}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function suggestPrompts() {
    setSuggesting(true);
    try {
      const res = await fetch('/api/ai/suggest-image-prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId: brandId || undefined, format: format.label, subject: subject || undefined }),
      });
      const j = await res.json();
      const list: string[] = j.data?.prompts ?? j.prompts ?? [];
      setSuggestions(list);
      if (list.length === 0) toast.message('Aucune suggestion');
    } catch {
      toast.error('Suggestion échouée');
    } finally {
      setSuggesting(false);
    }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const signRes = await fetch('/api/media/sign-upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'image/png' }),
      });
      const sj = await signRes.json();
      const cfg = sj.data ?? sj;
      if (!cfg?.configured || !cfg?.signedUrl) {
        toast.error('Stockage non configuré — colle plutôt une URL d\'image.');
        return;
      }
      await fetch(cfg.signedUrl, { method: 'PUT', headers: { 'content-type': file.type || 'image/png' }, body: file });
      const publicUrl: string = cfg.publicUrl ?? cfg.url;
      setSelected(publicUrl);
      setImages((prev) => [{ ok: true, url: publicUrl, provider: 'upload' }, ...prev]);
      toast.success('Image jointe — utilise-la dans un post ou télécharge-la.');
    } catch {
      toast.error('Upload échoué');
    } finally {
      setUploading(false);
    }
  }

  function usePastedUrl() {
    const u = attachUrl.trim();
    if (!/^https?:\/\//.test(u)) return toast.error('URL invalide (doit commencer par http)');
    setSelected(u);
    setImages((prev) => [{ ok: true, url: u, provider: 'url' }, ...prev]);
    setAttachUrl('');
    toast.success('Image jointe');
  }

  async function generateBrief() {
    setBriefLoading(true);
    try {
      const res = await fetch('/api/ai/generate-brief-canva', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId: brandId || undefined, format: format.label, subject, cta: '' }),
      });
      const j = await res.json();
      setBrief(j.data?.brief ?? j.brief ?? 'Brief indisponible.');
    } catch {
      setBrief('Brief indisponible.');
    } finally {
      setBriefLoading(false);
    }
  }

  async function schedulePost() {
    if (!createdPostId) { toast.error('Crée d\'abord un post avec ce visuel'); return; }
    setSharing('schedule');
    try {
      const scheduledFor = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postId: createdPostId,
          scheduledFor,
          ...(matchingAccount ? { socialAccountId: matchingAccount.id } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j?.message ?? 'Programmation échouée'); return; }
      toast.success(matchingAccount ? 'Programmé (publication auto) ✓' : 'Ajouté au calendrier (partage manuel) ✓', {
        action: { label: 'Calendrier', onClick: () => router.push('/calendar') },
      });
    } finally {
      setSharing(null);
    }
  }

  async function publishNow() {
    if (!createdPostId || !matchingAccount) return;
    setSharing('publish');
    try {
      const res = await fetch(`/api/posts/${createdPostId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ socialAccountId: matchingAccount.id }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j?.message ?? 'Publication échouée'); return; }
      toast.success(`Publié sur ${platformOfFormat} ✓`);
    } finally {
      setSharing(null);
    }
  }

  function openInCanva() {
    if (!brief) void generateBrief();
    // Canva's /create/<slug>/ deep links 404 for several types. The template
    // search URL is stable for every format and never 404s.
    const q = `${format.label} ${format.aspect}`;
    window.open(`https://www.canva.com/templates/?query=${encodeURIComponent(q)}`, '_blank', 'noopener');
  }

  async function loadCanvaDesigns() {
    setCanvaOpen(true);
    setCanvaLoading(true);
    try {
      const res = await fetch('/api/canva/designs', { cache: 'no-store' });
      const j = await res.json();
      const list = j.data?.designs ?? j.designs ?? [];
      setCanvaDesigns(list);
      setCanvaApiEnabled(j.data?.apiEnabled ?? true);
      if (list.length === 0) {
        toast.message('Aucun design Canva trouvé', { description: 'Crée-en un dans Canva (bouton ci-dessus) puis recharge.' });
      }
    } catch {
      toast.error('Impossible de charger les designs Canva');
    } finally {
      setCanvaLoading(false);
    }
  }

  function importCanvaDesign(d: { previewUrl?: string; url: string }) {
    if (d.previewUrl) {
      setSelected(d.previewUrl);
      setImages((prev) => [{ ok: true, url: d.previewUrl, provider: 'canva' }, ...prev]);
      toast.success('Design Canva importé — utilise-le dans un post ou télécharge-le.');
    } else {
      window.open(d.url, '_blank', 'noopener');
    }
  }

  function copyBrief() {
    if (!brief) return;
    navigator.clipboard.writeText(brief).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function useInPost() {
    if (!selected) return;
    setSavingPost(true);
    try {
      const formatMap: Record<string, string> = {
        ig_post: 'INSTAGRAM_POST', ig_portrait: 'INSTAGRAM_POST', ig_story: 'INSTAGRAM_STORY',
        fb_post: 'FACEBOOK_POST', li_post: 'LINKEDIN_POST', tw_post: 'TWITTER_POST',
        tiktok: 'TIKTOK_VIDEO', yt_thumb: 'YOUTUBE_THUMBNAIL', pin: 'PINTEREST_PIN', ad: 'AD_VISUAL',
      };
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: brandId || undefined,
          format: formatMap[formatKey] ?? 'INSTAGRAM_POST',
          title: subject.slice(0, 80),
          body: subject,
          coverImageUrl: selected,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j?.message ?? 'Création du post échouée'); return; }
      const newId = j.data?.id ?? j.id ?? null;
      setCreatedPostId(newId);
      toast.success('Post créé avec le visuel ✓ — tu peux le programmer ou le publier ci-dessous', {
        action: { label: 'Ouvrir', onClick: () => router.push('/posts') },
      });
    } finally {
      setSavingPost(false);
    }
  }

  const okImages = images.filter((i) => i.ok && i.url);
  const aspectClass: Record<AspectRatio, string> = {
    '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '9:16': 'aspect-[9/16]', '16:9': 'aspect-video',
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Palette className="h-6 w-6 text-fuchsia-600" /> Design Studio
        </h1>
        <p className="text-sm text-muted-foreground">
          Génère un visuel IA, affine-le dans Canva, puis crée ton post — en un seul endroit.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr_280px]">
        {/* ============ LEFT: format picker ============ */}
        <Card className="h-fit">
          <CardContent className="space-y-1 p-3">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Format
            </div>
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFormatKey(f.key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                  formatKey === f.key ? 'bg-fuchsia-50 font-medium text-fuchsia-800 ring-1 ring-fuchsia-200' : 'hover:bg-slate-50',
                )}
              >
                <span>{f.icon}</span>
                <span className="flex-1 truncate">{f.label}</span>
                <span className="text-[9px] text-muted-foreground">{f.aspect}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* ============ CENTER: brief + canvas ============ */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Marque</Label>
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  <option value="">— sans marque —</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Variantes</Label>
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} variante{n > 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Que veux-tu créer ?</Label>
              <Textarea
                rows={3}
                placeholder="Ex: une photo lifestyle d'un homme portant une chemise blanche en ville, lumière naturelle"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Style</Label>
              <div className="flex flex-wrap gap-1">
                {STYLES.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setStyle(s.value)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      style === s.value ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AI prompt suggestions (strategy + DNA aware) */}
            <div className="space-y-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fuchsia-900">💡 Prompts suggérés par l&apos;IA (depuis ta marque + stratégie)</span>
                <Button variant="outline" size="sm" onClick={suggestPrompts} disabled={suggesting}>
                  {suggesting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                  Suggérer
                </Button>
              </div>
              {suggestions.length > 0 ? (
                <ul className="space-y-1">
                  {suggestions.map((p, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => { setSubject(p); toast.success('Prompt appliqué — clique Générer'); }}
                        className="w-full rounded-md border bg-white p-2 text-left text-[11px] text-slate-700 hover:border-fuchsia-300 hover:bg-fuchsia-50"
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">Clique « Suggérer » pour obtenir 4 prompts pros optimisés.</p>
              )}
            </div>

            {/* Attach your own image */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 p-3">
              <span className="text-xs font-medium text-slate-700">📎 Ou joins ta propre image :</span>
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
                <span className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs hover:bg-slate-50">
                  {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />} Téléverser
                </span>
              </label>
              <Input value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} placeholder="Coller une URL d'image…" className="h-8 max-w-[220px] text-xs" />
              <Button variant="ghost" size="sm" onClick={usePastedUrl} disabled={!attachUrl}>Utiliser</Button>
            </div>

            <Button onClick={generate} disabled={loading} variant="brand" className="w-full sm:w-auto">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading ? 'Génération…' : 'Générer le visuel'}
            </Button>

            {/* canvas / preview */}
            {okImages.length > 0 ? (
              <div className="space-y-3">
                <div className={cn('mx-auto overflow-hidden rounded-xl border bg-slate-50 shadow-sm', aspectClass[format.aspect], format.aspect === '9:16' ? 'max-w-[280px]' : 'max-w-[440px]')}>
                  {selected ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected} alt="Visuel généré" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                {okImages.length > 1 ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {okImages.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelected(img.url!)}
                        className={cn(
                          'h-16 w-16 overflow-hidden rounded-md border-2',
                          selected === img.url ? 'border-fuchsia-400' : 'border-transparent hover:border-slate-300',
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt={`Variante ${i + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null}
                {okImages[0]?.mocked ? (
                  <p className="text-center text-xs text-amber-600">Visuel mock — configure une clé image (Replicate / OpenAI / Gemini) dans Admin.</p>
                ) : null}
              </div>
            ) : (
              <div className={cn('mx-auto flex items-center justify-center rounded-xl border-2 border-dashed bg-slate-50 text-sm text-muted-foreground', aspectClass[format.aspect], format.aspect === '9:16' ? 'max-w-[280px]' : 'max-w-[440px]')}>
                <div className="text-center">
                  <ImagePlus className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  Ton visuel apparaîtra ici
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ============ RIGHT: provider + actions ============ */}
        <div className="space-y-4">
          <Card className="h-fit">
            <CardContent className="space-y-3 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Moteur IA</div>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    title={p.hint}
                    onClick={() => setProvider(p.value)}
                    className={cn(
                      'rounded-md border px-2 py-2 text-xs transition-colors',
                      provider === p.value ? 'border-fuchsia-300 bg-fuchsia-50 font-medium text-fuchsia-800' : 'border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {selected ? (
            <Card className="h-fit">
              <CardContent className="space-y-2 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Actions</div>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setEditorOpen(true)}>
                  <Wand2 className="mr-2 h-4 w-4" /> Éditer (texte, filtres, recadrage)
                </Button>
                <a href={selected} download={`design-${format.key}.png`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Download className="mr-2 h-4 w-4" /> Télécharger
                  </Button>
                </a>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={useInPost} disabled={savingPost}>
                  {savingPost ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  Créer un post avec ce visuel
                </Button>

                {/* Direct share — available once a post exists */}
                {createdPostId ? (
                  <div className="space-y-1 border-t pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Partager</div>
                    <Button variant="outline" size="sm" className="w-full justify-start" onClick={schedulePost} disabled={sharing === 'schedule'}>
                      {sharing === 'schedule' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
                      Programmer (demain)
                    </Button>
                    <Button
                      variant="brand"
                      size="sm"
                      className="w-full justify-start"
                      onClick={publishNow}
                      disabled={!matchingAccount || sharing === 'publish'}
                      title={matchingAccount ? `Publier sur ${platformOfFormat}` : `Aucun compte ${platformOfFormat} connecté`}
                    >
                      {sharing === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      {matchingAccount ? `Publier sur ${platformOfFormat}` : `Connecter ${platformOfFormat}`}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Canva */}
          <Card className="h-fit border-violet-200 bg-gradient-to-br from-violet-50/50 to-white">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-violet-600" /> Affiner dans Canva
              </div>
              <p className="text-xs text-muted-foreground">
                Ouvre Canva au bon format et colle le brief IA (logo, couleurs, structure de la marque).
              </p>
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={openInCanva}>
                <ExternalLink className="mr-2 h-4 w-4" /> Ouvrir Canva ({format.label})
              </Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={generateBrief} disabled={briefLoading}>
                {briefLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Générer le brief IA
              </Button>

              {/* Round-trip: import a finished Canva design back into SocialFlow */}
              <div className="border-t pt-2">
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={loadCanvaDesigns} disabled={canvaLoading}>
                  {canvaLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                  Importer mes designs Canva
                </Button>
                {canvaOpen && !canvaApiEnabled ? (
                  <p className="mt-1 text-[11px] text-amber-600">API Canva non connectée — connecte-la dans Admin → Connexions.</p>
                ) : null}
                {canvaOpen && canvaDesigns.length > 0 ? (
                  <div className="mt-2 grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto">
                    {canvaDesigns.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => importCanvaDesign(d)}
                        title={d.title}
                        className="overflow-hidden rounded-md border bg-slate-50 transition-colors hover:border-violet-300"
                      >
                        {d.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.previewUrl} alt={d.title} className="aspect-square w-full object-cover" />
                        ) : (
                          <div className="flex aspect-square items-center justify-center text-[9px] text-muted-foreground">{d.title.slice(0, 18)}</div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {brief ? (
                <div className="space-y-1">
                  <Textarea rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} className="text-[11px]" />
                  <Button variant="outline" size="sm" className="w-full" onClick={copyBrief}>
                    {copied ? <Check className="mr-2 h-3 w-3" /> : <Copy className="mr-2 h-3 w-3" />}
                    {copied ? 'Copié' : 'Copier le brief'}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {editorOpen && selected ? (
        <DesignEditor
          imageUrl={selected}
          aspect={format.aspect}
          onClose={() => setEditorOpen(false)}
          onExport={(dataUrl) => {
            setSelected(dataUrl);
            setImages((prev) => [{ ok: true, url: dataUrl, provider: 'edited' }, ...prev]);
          }}
        />
      ) : null}
    </div>
  );
}
