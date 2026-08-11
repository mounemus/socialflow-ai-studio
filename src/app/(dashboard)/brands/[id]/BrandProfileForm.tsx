'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AIEnrichButton, AIEnrichAllButton } from '@/components/ui/ai-enrich-button';
import { MediaUploader } from '@/components/ui/media-uploader';

type Profile = {
  slogan?: string | null;
  mission?: string | null;
  audienceTarget?: string | null;
  productsServices?: string[];
  toneOfVoice?: string | null;
  wordsToUse?: string[];
  wordsToAvoid?: string[];
  officialHashtags?: string[];
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  typography?: string | null;
  visualStyle?: string | null;
};

type Form = {
  slogan: string;
  mission: string;
  audienceTarget: string;
  productsServices: string;
  toneOfVoice: string;
  wordsToUse: string;
  wordsToAvoid: string;
  officialHashtags: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  typography: string;
  visualStyle: string;
};

const FIELD_TO_FORM_KEY: Record<string, keyof Form> = {
  slogan: 'slogan',
  mission: 'mission',
  audienceTarget: 'audienceTarget',
  productsServices: 'productsServices',
  toneOfVoice: 'toneOfVoice',
  wordsToUse: 'wordsToUse',
  wordsToAvoid: 'wordsToAvoid',
  officialHashtags: 'officialHashtags',
  primaryColor: 'primaryColor',
  secondaryColor: 'secondaryColor',
  accentColor: 'accentColor',
  typography: 'typography',
  visualStyle: 'visualStyle',
};

function formatForInput(field: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (field === 'officialHashtags') return value.join(' ');
    return value.join(', ');
  }
  return value == null ? '' : String(value);
}

function readFile(file: File): Promise<{ text?: string; docxBase64?: string; pdfBase64?: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const name = file.name.toLowerCase();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    if (name.endsWith('.docx')) {
      reader.onload = () => resolve({ docxBase64: String(reader.result).split(',')[1] });
      reader.readAsDataURL(file);
    } else if (name.endsWith('.pdf')) {
      reader.onload = () => resolve({ pdfBase64: String(reader.result).split(',')[1] });
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve({ text: String(reader.result) });
      reader.readAsText(file);
    }
  });
}

export function BrandProfileForm({ brandId, initial, logo: initialLogo }: { brandId: string; initial: Profile | null; logo?: string | null }) {
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [logo, setLogo] = useState<string>(initialLogo ?? '');
  const [form, setForm] = useState<Form>({
    slogan: initial?.slogan ?? '',
    mission: initial?.mission ?? '',
    audienceTarget: initial?.audienceTarget ?? '',
    productsServices: (initial?.productsServices ?? []).join(', '),
    toneOfVoice: initial?.toneOfVoice ?? '',
    wordsToUse: (initial?.wordsToUse ?? []).join(', '),
    wordsToAvoid: (initial?.wordsToAvoid ?? []).join(', '),
    officialHashtags: (initial?.officialHashtags ?? []).join(' '),
    primaryColor: initial?.primaryColor ?? '',
    secondaryColor: initial?.secondaryColor ?? '',
    accentColor: initial?.accentColor ?? '',
    typography: initial?.typography ?? '',
    visualStyle: initial?.visualStyle ?? '',
  });

  const split = (s: string, sep = ',') => s.split(sep).map((x) => x.trim()).filter(Boolean);

  // Compute empty fields for the "Enrich all" master button
  const emptyFields = (Object.keys(FIELD_TO_FORM_KEY) as Array<keyof typeof FIELD_TO_FORM_KEY>)
    .filter((f) => !form[FIELD_TO_FORM_KEY[f]] || form[FIELD_TO_FORM_KEY[f]].trim() === '');

  const enrichPayload = (fields: string[]) => ({
    brandId,
    fields,
    current: {
      slogan: form.slogan || undefined,
      mission: form.mission || undefined,
      audienceTarget: form.audienceTarget || undefined,
      productsServices: split(form.productsServices),
      toneOfVoice: form.toneOfVoice || undefined,
      wordsToUse: split(form.wordsToUse),
      wordsToAvoid: split(form.wordsToAvoid),
      officialHashtags: split(form.officialHashtags, ' '),
      primaryColor: form.primaryColor || undefined,
      secondaryColor: form.secondaryColor || undefined,
      accentColor: form.accentColor || undefined,
      typography: form.typography || undefined,
      visualStyle: form.visualStyle || undefined,
    },
  });

  function applySuggestion(field: string, value: unknown) {
    const key = FIELD_TO_FORM_KEY[field];
    if (!key) return;
    setForm((f) => ({ ...f, [key]: formatForInput(field, value) }));
  }

  function applyAll(suggestions: Record<string, unknown>) {
    setForm((f) => {
      const next = { ...f };
      for (const [field, value] of Object.entries(suggestions)) {
        const key = FIELD_TO_FORM_KEY[field];
        if (key) next[key] = formatForInput(field, value);
      }
      return next;
    });
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // allow re-selecting the same file
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (max 4 Mo)');
      return;
    }
    setImporting(true);
    try {
      const payload = await readFile(file);
      const res = await fetch('/api/ai/import/brand-profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId, filename: file.name, ...payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.message ?? "Échec de l'extraction");
        return;
      }
      const { data } = (await res.json()) as {
        data: { fields: Record<string, unknown>; provider: string; mocked: boolean };
      };
      // Keep only fields that map to the form
      const mapped = Object.entries(data.fields ?? {}).filter(([f]) => FIELD_TO_FORM_KEY[f]);
      if (mapped.length === 0) {
        toast.info('Aucun champ exploitable trouvé dans le document');
        return;
      }
      const conflicts = mapped.filter(([f]) => form[FIELD_TO_FORM_KEY[f]].trim() !== '');
      let overwrite = true;
      if (conflicts.length > 0) {
        overwrite = window.confirm(`${conflicts.length} champ(s) déjà rempli(s) seront remplacé(s). Continuer ?`);
      }
      const toApply = overwrite ? mapped : mapped.filter(([f]) => form[FIELD_TO_FORM_KEY[f]].trim() === '');
      applyAll(Object.fromEntries(toApply));
      if (data.mocked) {
        toast.warning('Extraction simulée — provider IA indisponible');
      } else {
        toast.success(`${toApply.length} champ(s) importé(s) depuis ${file.name} (${data.provider})`);
      }
    } catch {
      toast.error("Échec de l'import du document");
    } finally {
      setImporting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/brands/${brandId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        logo: logo || null,
        profile: {
          slogan: form.slogan,
          mission: form.mission,
          audienceTarget: form.audienceTarget,
          productsServices: split(form.productsServices),
          toneOfVoice: form.toneOfVoice,
          wordsToUse: split(form.wordsToUse),
          wordsToAvoid: split(form.wordsToAvoid),
          officialHashtags: split(form.officialHashtags, ' '),
          primaryColor: form.primaryColor || undefined,
          secondaryColor: form.secondaryColor || undefined,
          accentColor: form.accentColor || undefined,
          typography: form.typography,
          visualStyle: form.visualStyle,
        },
      }),
    });
    setSaving(false);
    if (res.ok) toast.success('Profil mis à jour');
    else toast.error('Erreur');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-violet-300 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4">
        <div>
          <div className="text-sm font-semibold text-violet-900">Enrichir avec l'IA ✨</div>
          <p className="text-xs text-violet-700">
            L'IA suggère des valeurs cohérentes pour les champs vides en utilisant le nom, l'industrie et les valeurs déjà remplies comme contexte.
          </p>
        </div>
        <AIEnrichAllButton
          endpoint="/api/ai/enrich/brand-profile"
          emptyFields={emptyFields}
          buildPayload={enrichPayload}
          onResults={applyAll}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
        <div>
          <div className="text-sm font-semibold">Importer depuis un document</div>
          <p className="text-xs text-muted-foreground">
            Chargez une charte ou un document de stratégie (.pdf, .docx, .md, .txt) — l'IA en extrait les champs du profil de marque.
          </p>
        </div>
        <label className="cursor-pointer">
          <span className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent">
            {importing ? 'Extraction…' : 'Choisir un fichier'}
          </span>
          <input
            type="file"
            accept=".md,.txt,.docx,.pdf"
            className="hidden"
            disabled={importing}
            onChange={onImportFile}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Slogan</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['slogan'])}
              field="slogan"
              onResult={(v) => applySuggestion('slogan', v)}
            />
          </div>
          <Input value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Ton de voix</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['toneOfVoice'])}
              field="toneOfVoice"
              onResult={(v) => applySuggestion('toneOfVoice', v)}
            />
          </div>
          <Input value={form.toneOfVoice} onChange={(e) => setForm({ ...form, toneOfVoice: e.target.value })} placeholder="Ex: chaleureux, expert, audacieux" />
        </div>

        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Mission</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['mission'])}
              field="mission"
              onResult={(v) => applySuggestion('mission', v)}
            />
          </div>
          <Textarea rows={3} value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Audience cible</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['audienceTarget'])}
              field="audienceTarget"
              onResult={(v) => applySuggestion('audienceTarget', v)}
            />
          </div>
          <Input value={form.audienceTarget} onChange={(e) => setForm({ ...form, audienceTarget: e.target.value })} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Services / offres (séparés par virgules)</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['productsServices'])}
              field="productsServices"
              onResult={(v) => applySuggestion('productsServices', v)}
            />
          </div>
          <Textarea
            rows={2}
            value={form.productsServices}
            onChange={(e) => setForm({ ...form, productsServices: e.target.value })}
            placeholder="Ex: FabLab nomade (écoles/entreprises), 21 formations pro, coworking, café culturel, location d'imprimantes 3D"
          />
          <p className="text-[11px] text-muted-foreground">
            Utilisé par la Veille intelligente, la Prospection et les analyses IA — liste TOUS tes services pour des rapports qui couvrent toute l&apos;offre.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Mots à utiliser (séparés par virgules)</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['wordsToUse'])}
              field="wordsToUse"
              onResult={(v) => applySuggestion('wordsToUse', v)}
            />
          </div>
          <Input value={form.wordsToUse} onChange={(e) => setForm({ ...form, wordsToUse: e.target.value })} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Mots à éviter</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['wordsToAvoid'])}
              field="wordsToAvoid"
              onResult={(v) => applySuggestion('wordsToAvoid', v)}
            />
          </div>
          <Input value={form.wordsToAvoid} onChange={(e) => setForm({ ...form, wordsToAvoid: e.target.value })} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Hashtags officiels (séparés par espace)</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['officialHashtags'])}
              field="officialHashtags"
              onResult={(v) => applySuggestion('officialHashtags', v)}
            />
          </div>
          <Input value={form.officialHashtags} onChange={(e) => setForm({ ...form, officialHashtags: e.target.value })} placeholder="#brand #signature" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Couleur principale (HEX)</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['primaryColor'])}
              field="primaryColor"
              onResult={(v) => applySuggestion('primaryColor', v)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="#3d62f5" />
            {form.primaryColor ? (
              <div className="h-10 w-10 shrink-0 rounded-md border" style={{ backgroundColor: form.primaryColor }} />
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Couleur secondaire (HEX)</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['secondaryColor'])}
              field="secondaryColor"
              onResult={(v) => applySuggestion('secondaryColor', v)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input value={form.secondaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })} placeholder="#1a2e8c" />
            {form.secondaryColor ? (
              <div className="h-10 w-10 shrink-0 rounded-md border" style={{ backgroundColor: form.secondaryColor }} />
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Couleur d'accent (HEX)</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['accentColor'])}
              field="accentColor"
              onResult={(v) => applySuggestion('accentColor', v)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} placeholder="#ff6b6b" />
            {form.accentColor ? (
              <div className="h-10 w-10 shrink-0 rounded-md border" style={{ backgroundColor: form.accentColor }} />
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Typographie</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['typography'])}
              field="typography"
              onResult={(v) => applySuggestion('typography', v)}
            />
          </div>
          <Input value={form.typography} onChange={(e) => setForm({ ...form, typography: e.target.value })} placeholder='Ex: "Montserrat pour les titres, Inter pour le corps"' />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Style visuel</Label>
            <AIEnrichButton
              endpoint="/api/ai/enrich/brand-profile"
              payload={enrichPayload(['visualStyle'])}
              field="visualStyle"
              onResult={(v) => applySuggestion('visualStyle', v)}
            />
          </div>
          <Input value={form.visualStyle} onChange={(e) => setForm({ ...form, visualStyle: e.target.value })} placeholder="minimal, organique, éditorial..." />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Logo de la marque</Label>
          {logo ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="Logo de la marque" className="h-16 rounded-md border bg-white object-contain p-1" />
              <Button type="button" variant="outline" size="sm" onClick={() => setLogo('')}>Retirer</Button>
            </div>
          ) : null}
          <MediaUploader
            brandId={brandId}
            accept="image/*"
            multiple={false}
            maxSizeMB={5}
            onUploaded={(media) => setLogo(media.url)}
          />
          <p className="text-xs text-muted-foreground">Le logo est enregistré avec le profil (bouton Enregistrer).</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="brand" disabled={saving}>{saving ? 'Sauvegarde…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}
