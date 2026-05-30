'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Workflow } from 'lucide-react';
import { toast } from 'sonner';

type Horizon = '30d' | '90d' | '12mo';

export default function NewPipelinePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    industry: '',
    description: '',
    website: '',
    audienceHint: '',
    horizon: '90d' as Horizon,
    language: 'fr',
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Le nom de la marque est requis');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seed: {
          name: form.name.trim(),
          industry: form.industry.trim() || undefined,
          description: form.description.trim() || undefined,
          website: form.website.trim() || undefined,
          audienceHint: form.audienceHint.trim() || undefined,
        },
        horizon: form.horizon,
        language: form.language,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? `Lancement impossible (HTTP ${res.status})`);
      return;
    }
    const { data } = await res.json();
    toast.success('Pipeline lancé');
    router.push(`/pipelines/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            Nouveau pipeline
          </CardTitle>
          <CardDescription>
            Décris ta marque en quelques mots. L&apos;agent IA va enrichir le profil, générer une stratégie complète et
            planifier les publications — avec validation à chaque étape critique.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nom de la marque *</Label>
              <Input
                id="name"
                required
                placeholder="Acme Studio"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industrie</Label>
              <Input
                id="industry"
                placeholder="SaaS B2B, e-commerce mode, restauration..."
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Site web</Label>
              <Input
                id="website"
                type="url"
                placeholder="https://exemple.com"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={3}
                placeholder="Que fait la marque, pour qui, qu'est-ce qui la rend unique ?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audienceHint">Audience cible (indice)</Label>
              <Input
                id="audienceHint"
                placeholder="Femmes 25-40, urbaines, sensibles à l'éco-responsabilité"
                value={form.audienceHint}
                onChange={(e) => setForm({ ...form, audienceHint: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="horizon">Horizon stratégique</Label>
                <select
                  id="horizon"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.horizon}
                  onChange={(e) => setForm({ ...form, horizon: e.target.value as Horizon })}
                >
                  <option value="30d">30 jours</option>
                  <option value="90d">90 jours</option>
                  <option value="12mo">12 mois</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="language">Langue</Label>
                <select
                  id="language"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Annuler
            </Button>
            <Button type="submit" variant="brand" disabled={loading}>
              {loading ? 'Lancement…' : 'Lancer le pipeline'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
