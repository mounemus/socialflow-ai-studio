'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PromptAssistButton } from '@/components/ai/PromptAssistButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SocialTextEditor } from '@/components/ui/social-text-editor';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Sparkles, ArrowRight, Calendar as CalendarIcon, ImagePlus } from 'lucide-react';
import { InlineScoreWidget } from '@/components/intelligence/InlineScoreWidget';
import { platformFromFormat } from '@/lib/post-status';

const PLATFORMS = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'];
const FORMATS = [
  'INSTAGRAM_POST', 'INSTAGRAM_STORY', 'INSTAGRAM_REEL', 'INSTAGRAM_CAROUSEL',
  'FACEBOOK_POST', 'LINKEDIN_POST', 'LINKEDIN_ARTICLE', 'TWITTER_POST', 'TWITTER_THREAD',
  'TIKTOK_VIDEO', 'YOUTUBE_SHORT', 'PINTEREST_PIN',
  'EMAIL_MARKETING', 'NEWSLETTER', 'AD_VISUAL', 'VIDEO_SCRIPT',
];

interface Brand { id: string; name: string }

interface LoadedPost {
  id: string;
  title: string | null;
  body: string | null;
  format: string;
  brandId: string | null;
  brand?: { id: string; name: string } | null;
  hashtags: string[];
  cta: string | null;
  status: string;
}

/**
 * `initialBrandId` / `initialPlatform` permettent à l'Atelier créatif de
 * transmettre le contexte choisi dans l'onglet Brief : sans cela chaque onglet
 * repartait de « sans marque » et la continuité entre étapes était rompue.
 */
export function TextStudio({
  initialBrandId,
  initialPlatform,
  initialPostId,
  initialObjective,
  initialAudience,
  onRequestVisual,
}: {
  initialBrandId?: string;
  initialPlatform?: string;
  initialPostId?: string;
  /** Objectif défini dans le Brief de l'Atelier — injecté dans la génération. */
  initialObjective?: string;
  /** Audience définie dans le Brief de l'Atelier — prime sur le profil de marque. */
  initialAudience?: string;
  /** Fourni par l'Atelier : bascule sur l'onglet Visuel sans naviguer (le travail en cours est préservé). */
  onRequestVisual?: () => void;
} = {}) {
  const sp = useSearchParams();
  const router = useRouter();
  // La publication de travail vient de l'Atelier (sélecteur en haut) ou de
  // l'URL. Sans `initialPostId`, changer de post dans l'Atelier ne suivait pas
  // ici : on éditait toujours celui de l'URL, d'où l'impression de perdre le
  // travail en passant d'un onglet à l'autre.
  const editingPostId = initialPostId ?? sp.get('postId');

  const [brands, setBrands] = useState<Brand[]>([]);
  const [loadedPost, setLoadedPost] = useState<LoadedPost | null>(null);
  const [form, setForm] = useState({
    brandId: initialBrandId ?? '',
    platform: initialPlatform ?? 'INSTAGRAM',
    format: 'INSTAGRAM_POST',
    tone: '',
    audience: '',
    cta: '',
    language: 'fr',
    prompt: '',
  });

  // Suit le contexte défini en amont (onglet Brief de l'Atelier créatif).
  // Deux effets SÉPARÉS : avant, un changement de marque seul (l'Atelier fait
  // setBrandId au chargement du post) re-déclenchait aussi la synchro
  // plateforme et écrasait celle déjà dérivée du format du post.
  useEffect(() => {
    if (initialBrandId === undefined) return;
    setForm((f) => (f.brandId === initialBrandId ? f : { ...f, brandId: initialBrandId }));
  }, [initialBrandId]);
  useEffect(() => {
    if (initialPlatform === undefined) return;
    setForm((f) => (f.platform === initialPlatform ? f : { ...f, platform: initialPlatform }));
  }, [initialPlatform]);
  // Audience du Brief de l'Atelier : une seule saisie fait foi — elle remplace
  // la valeur locale (le champ reste éditable pour surcharger ponctuellement).
  useEffect(() => {
    if (!initialAudience) return;
    setForm((f) => (f.audience === initialAudience ? f : { ...f, audience: initialAudience }));
  }, [initialAudience]);
  const [generatedText, setGeneratedText] = useState<string>('');
  const [result, setResult] = useState<{ text: string; provider: string; mocked: boolean; hashtags?: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingToPost, setSavingToPost] = useState(false);

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => setBrands(d.data ?? []));
  }, []);

  // Pré-remplit Ton/Audience depuis le profil de la marque sélectionnée — ce
  // qui est déjà établi sur la marque n'est plus redemandé (l'utilisateur peut
  // toujours surcharger à la main).
  useEffect(() => {
    const b = brands.find((x) => x.id === form.brandId) as
      | { profile?: { toneOfVoice?: string | null; audienceTarget?: string | null } | null }
      | undefined;
    if (!b?.profile) return;
    setForm((f) => ({
      ...f,
      tone: f.tone || (b.profile?.toneOfVoice ?? ''),
      audience: f.audience || (b.profile?.audienceTarget ?? ''),
    }));
  }, [brands, form.brandId]);

  // === Load existing post if ?postId= ===
  useEffect(() => {
    if (!editingPostId) return;
    fetch(`/api/posts/${editingPostId}`).then((r) => r.json()).then(({ data }) => {
      if (!data) return;
      setLoadedPost(data);
      setForm((f) => ({
        ...f,
        brandId: data.brandId ?? '',
        format: data.format,
        platform: platformFromFormat(data.format) ?? f.platform,
        cta: data.cta ?? '',
        prompt: `Améliore et enrichis ce post existant pour qu'il soit prêt à publier:\n\nTitre: ${data.title ?? '(pas de titre)'}\nBody actuel: ${data.body ?? '(vide)'}\n\nObjectif: rendre le contenu prêt à publier, ajouter hooks, structure, hashtags pertinents.`,
      }));
      setGeneratedText(data.body ?? '');
    });
  }, [editingPostId]);

  async function generate(saveAsDraft = false) {
    if (form.prompt.length < 5) {
      toast.error('Décris le contenu à générer (au moins 5 caractères)');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/ai/generate-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // postId : permet au serveur de retrouver la stratégie d'origine du post
      // (piliers de contenu) et de l'injecter dans le contexte de génération.
      // L'objectif du Brief (Atelier) est intégré au prompt — saisi une fois,
      // utilisé par la génération sans re-saisie.
      body: JSON.stringify({
        ...form,
        prompt: initialObjective ? `Objectif de la publication : ${initialObjective}\n\n${form.prompt}` : form.prompt,
        postId: editingPostId ?? undefined,
        saveAsDraft: editingPostId ? false : saveAsDraft,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      toast.error('Génération échouée');
      return;
    }
    const { data } = await res.json();
    setResult(data);
    setGeneratedText(data.text);
    if (saveAsDraft && !editingPostId) {
      // Enchaînement « Orbit » : après la création, la prochaine action utile
      // est la programmation — un clic ouvre l'atelier sur l'onglet Diffusion.
      const newPostId = (data as { post?: { id?: string } | null }).post?.id;
      toast.success('Brouillon enregistré', {
        ...(newPostId
          ? {
              description: 'Prochaine étape : programmer sa diffusion.',
              action: {
                label: 'Programmer',
                onClick: () => router.push(`/studio?postId=${newPostId}&tab=diffusion`),
              },
            }
          : {}),
      });
    }
  }

  async function saveToExistingPost() {
    if (!editingPostId || !generatedText) return;
    setSavingToPost(true);
    const res = await fetch(`/api/posts/${editingPostId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      // Hashtags et CTA de la génération : sans eux, la sauvegarde ne gardait
      // que le body et le travail de l'IA était silencieusement perdu.
      body: JSON.stringify({
        body: generatedText,
        status: 'DRAFT',
        ...(result?.hashtags?.length ? { hashtags: result.hashtags } : {}),
        ...(form.cta ? { cta: form.cta } : {}),
      }),
    });
    setSavingToPost(false);
    if (!res.ok) return toast.error('Sauvegarde échouée');
    toast.success('Post mis à jour ✓', {
      description: 'Le brouillon contient maintenant le contenu enrichi',
      action: {
        label: 'Programmer',
        onClick: () => router.push(`/studio?postId=${editingPostId}&tab=diffusion`),
      },
    });
  }

  return (
    <div className="space-y-4">
      {/* === EDITING EXISTING POST BANNER === */}
      {loadedPost ? (
        <Card className="border-brand-300 bg-gradient-to-r from-brand-50 to-violet-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-brand-600" />
              <div>
                <div className="text-sm font-semibold">Mode design assisté — Post existant</div>
                <div className="text-xs text-muted-foreground">
                  <Badge variant="secondary" className="mr-1">{loadedPost.brand?.name ?? 'sans marque'}</Badge>
                  <Badge variant="info" className="mr-1">{loadedPost.format}</Badge>
                  <span>Titre: <strong>{loadedPost.title ?? '(pas de titre)'}</strong></span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <a href={`/posts/${loadedPost.id}`}>
                <Button variant="outline" size="sm">Voir le brouillon</Button>
              </a>
              <a href="/calendar">
                <Button variant="outline" size="sm">
                  <CalendarIcon className="mr-1 h-3 w-3" /> Calendrier
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Paramètres</CardTitle>
            <CardDescription>Ces paramètres pilotent la qualité.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Marque</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                <option value="">— sans marque —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Plateforme</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Format</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Ton</Label>
              <Input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="inspirant, didactique…" />
            </div>
            <div className="space-y-1">
              <Label>Audience</Label>
              <Input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="entrepreneurs B2B, parents…" />
            </div>
            <div className="space-y-1">
              <Label>CTA</Label>
              <Input value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} placeholder="Découvre →" />
            </div>
            <div className="space-y-1">
              <Label>Langue</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{loadedPost ? 'Enrichir le contenu' : 'Brief & génération'}</CardTitle>
            <CardDescription>
              {loadedPost
                ? 'L\'IA améliore le post existant en gardant l\'esprit + ajoute structure, hooks, hashtags.'
                : 'Décris ce que tu veux. L\'IA s\'adapte à la marque.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              rows={6}
              placeholder={loadedPost ? 'Le brief est pré-rempli depuis le post existant. Tu peux ajouter des instructions supplémentaires.' : 'Ex: annonce du lancement de notre nouveau produit X, ton chaleureux, mettre l\'accent sur la durabilité'}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <PromptAssistButton
                kind="text"
                draft={form.prompt}
                brandId={form.brandId || undefined}
                platform={form.platform}
                format={form.format}
                onResult={(p) => setForm((f) => ({ ...f, prompt: p }))}
                label="Rédiger le brief avec l’IA"
              />
              <Button onClick={() => generate(false)} variant="brand" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {loading ? 'Génération…' : (loadedPost ? 'Régénérer' : 'Générer')}
              </Button>
              {!loadedPost ? (
                <Button onClick={() => generate(true)} variant="outline" disabled={loading}>
                  Générer + enregistrer en brouillon
                </Button>
              ) : null}
            </div>

            {generatedText ? (
              <div className="space-y-2">
                <Label>Contenu généré (éditable)</Label>
                <SocialTextEditor rows={10} value={generatedText} onChange={setGeneratedText} />
                {result ? (
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={result.mocked ? 'warning' : 'success'} className="text-[10px]">
                      {result.mocked ? `Mock (${result.provider})` : `Réel (${result.provider})`}
                    </Badge>
                    {(result as { strategyApplied?: string | null }).strategyApplied ? (
                      <Badge variant="info" className="text-[10px]">
                        Aligné sur la stratégie « {(result as { strategyApplied?: string | null }).strategyApplied} »
                      </Badge>
                    ) : null}
                  </div>
                ) : null}

                <InlineScoreWidget
                  body={generatedText}
                  cta={form.cta || null}
                  platform={form.platform}
                  format={form.format}
                  language={form.language}
                  brandId={form.brandId || null}
                  postId={editingPostId ?? undefined}
                />


                {loadedPost ? (
                  <div className="flex flex-wrap gap-2 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                    <Button onClick={saveToExistingPost} variant="brand" disabled={savingToPost || !generatedText}>
                      {savingToPost ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Sauvegarder dans le brouillon
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        onRequestVisual
                          ? onRequestVisual()
                          : router.push(`/studio?postId=${loadedPost.id}&tab=visuel`)
                      }
                    >
                      <ImagePlus className="mr-2 h-4 w-4" /> Générer un visuel
                    </Button>
                    <Button variant="outline" onClick={() => router.push(`/posts/${loadedPost.id}`)}>
                      <ArrowRight className="mr-2 h-4 w-4" /> Aller au brouillon
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
