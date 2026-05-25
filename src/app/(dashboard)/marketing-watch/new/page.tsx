'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const KINDS = ['RSS', 'KEYWORD', 'HASHTAG', 'COMPETITOR', 'GOOGLE_TRENDS', 'TIKTOK_TRENDS', 'REDDIT', 'YOUTUBE'];

export default function NewWatchPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    kind: 'RSS',
    rssUrl: '',
    query: '',
    keywords: '',
    language: 'fr',
    country: '',
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/watch/trends', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        keywords: form.keywords.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    });
    setLoading(false);
    if (!res.ok) {
      toast.error('Création impossible');
      return;
    }
    toast.success('Veille créée');
    router.push('/marketing-watch');
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Nouvelle veille</CardTitle>
          <CardDescription>RSS fonctionne sans API tierce. Les autres types nécessitent des intégrations dédiées (voir docs/API_LIMITS.md).</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Nom de la veille</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Langue</Label>
              <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            </div>
            {form.kind === 'RSS' ? (
              <div className="space-y-2 md:col-span-2">
                <Label>URL RSS</Label>
                <Input type="url" required={form.kind === 'RSS'} value={form.rssUrl} onChange={(e) => setForm({ ...form, rssUrl: e.target.value })} placeholder="https://example.com/feed.xml" />
              </div>
            ) : (
              <div className="space-y-2 md:col-span-2">
                <Label>Requête</Label>
                <Input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} placeholder="mot-clé ou hashtag" />
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label>Mots-clés (séparés par virgule)</Label>
              <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="ia, marketing, growth" />
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" variant="brand" disabled={loading}>{loading ? '...' : 'Créer'}</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
