'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Profile = {
  slogan?: string | null;
  mission?: string | null;
  audienceTarget?: string | null;
  toneOfVoice?: string | null;
  wordsToUse?: string[];
  wordsToAvoid?: string[];
  officialHashtags?: string[];
  primaryColor?: string | null;
  visualStyle?: string | null;
};

export function BrandProfileForm({ brandId, initial }: { brandId: string; initial: Profile | null }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    slogan: initial?.slogan ?? '',
    mission: initial?.mission ?? '',
    audienceTarget: initial?.audienceTarget ?? '',
    toneOfVoice: initial?.toneOfVoice ?? '',
    wordsToUse: (initial?.wordsToUse ?? []).join(', '),
    wordsToAvoid: (initial?.wordsToAvoid ?? []).join(', '),
    officialHashtags: (initial?.officialHashtags ?? []).join(' '),
    primaryColor: initial?.primaryColor ?? '',
    visualStyle: initial?.visualStyle ?? '',
  });

  const split = (s: string, sep = ',') => s.split(sep).map((x) => x.trim()).filter(Boolean);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/brands/${brandId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: {
          slogan: form.slogan,
          mission: form.mission,
          audienceTarget: form.audienceTarget,
          toneOfVoice: form.toneOfVoice,
          wordsToUse: split(form.wordsToUse),
          wordsToAvoid: split(form.wordsToAvoid),
          officialHashtags: split(form.officialHashtags, ' '),
          primaryColor: form.primaryColor || undefined,
          visualStyle: form.visualStyle,
        },
      }),
    });
    setSaving(false);
    if (res.ok) toast.success('Profil mis à jour');
    else toast.error('Erreur');
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Slogan</Label>
        <Input value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Ton de voix</Label>
        <Input value={form.toneOfVoice} onChange={(e) => setForm({ ...form, toneOfVoice: e.target.value })} placeholder="Ex: chaleureux, expert, audacieux" />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Mission</Label>
        <Textarea rows={3} value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Audience cible</Label>
        <Input value={form.audienceTarget} onChange={(e) => setForm({ ...form, audienceTarget: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Mots à utiliser (séparés par virgules)</Label>
        <Input value={form.wordsToUse} onChange={(e) => setForm({ ...form, wordsToUse: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Mots à éviter</Label>
        <Input value={form.wordsToAvoid} onChange={(e) => setForm({ ...form, wordsToAvoid: e.target.value })} />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Hashtags officiels (séparés par espace)</Label>
        <Input value={form.officialHashtags} onChange={(e) => setForm({ ...form, officialHashtags: e.target.value })} placeholder="#brand #signature" />
      </div>
      <div className="space-y-2">
        <Label>Couleur principale (HEX)</Label>
        <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="#3d62f5" />
      </div>
      <div className="space-y-2">
        <Label>Style visuel</Label>
        <Input value={form.visualStyle} onChange={(e) => setForm({ ...form, visualStyle: e.target.value })} placeholder="minimal, organique, éditorial..." />
      </div>
      <div className="md:col-span-2 flex justify-end">
        <Button type="submit" variant="brand" disabled={saving}>{saving ? 'Sauvegarde…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}
