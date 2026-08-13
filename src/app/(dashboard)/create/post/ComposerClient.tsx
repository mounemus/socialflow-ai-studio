'use client';

/**
 * Rampe de lancement d'une publication manuelle.
 *
 * Remplace l'ancien composeur complet (texte + visuel + adaptations) qui
 * DUPLIQUAIT les onglets du Studio : trois ateliers concurrents pour la même
 * tâche, champs re-saisis, travail éclaté. Ici on ne saisit que le cadrage —
 * marque, plateforme, format, langue, objectif — UNE seule fois, puis le
 * Studio (atelier unique) prend le relais avec tous les outils : texte IA,
 * visuel, carrousel/reel, Canva, variantes, aperçu, validation, diffusion.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Loader2, PencilLine } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/client-api-error';

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

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export function ComposerClient({ brands, defaultBrandId }: { brands: Brand[]; defaultBrandId: string | null }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(defaultBrandId ?? brands[0]?.id ?? '');
  const [platform, setPlatform] = useState('LINKEDIN');
  const [format, setFormat] = useState(FORMAT_OPTIONS.LINKEDIN[0].value);
  const [language, setLanguage] = useState('fr');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  async function createAndOpen() {
    setBusy(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: brandId || undefined,
          format,
          language,
          title: brief.slice(0, 80) || 'Nouvelle publication',
          status: 'DRAFT',
          ...(brief.trim() ? { objective: brief.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const json = await res.json();
      const id = json?.data?.id as string | undefined;
      if (!id) throw new Error('Création impossible');
      router.push(`/studio?postId=${id}`);
    } catch (err) {
      toast.error((err as Error).message.slice(0, 120));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <PencilLine className="h-6 w-6 text-brand-600" /> Nouvelle publication
        </h1>
        <p className="text-sm text-muted-foreground">
          Cadrez la publication une seule fois — le Studio prend le relais avec
          tous les outils (texte IA, visuel, carrousel, vidéo, variantes, diffusion).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Où publier ?</CardTitle>
          <CardDescription>Ces choix contextualisent tout le travail dans le Studio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Marque</Label>
            <select className={selectClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">— Sans marque —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Plateforme</Label>
              <select
                className={selectClass}
                value={platform}
                onChange={(e) => {
                  setPlatform(e.target.value);
                  setFormat(FORMAT_OPTIONS[e.target.value][0].value);
                }}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Type de support</Label>
              <select className={selectClass} value={format} onChange={(e) => setFormat(e.target.value)}>
                {(FORMAT_OPTIONS[platform] ?? []).map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Langue du contenu</Label>
            <select className={selectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Objectif (optionnel)</Label>
            <Textarea
              rows={2}
              placeholder="En une phrase : de quoi parle la publication, quel but ?"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Repris automatiquement dans le Brief du Studio — vous ne le retaperez pas.
            </p>
          </div>
          <Button variant="brand" className="w-full" size="lg" onClick={createAndOpen} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Créer et ouvrir dans le Studio <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
