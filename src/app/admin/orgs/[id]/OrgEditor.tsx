'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PLANS = ['FREE', 'PRO', 'AGENCY', 'ENTERPRISE'];

export function OrgEditor({ org }: { org: { id: string; name: string; plan: string } }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: org.name, plan: org.plan });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/orgs/${org.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Organisation mise à jour');
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Supprimer définitivement "${org.name}" ? Toutes les données (brands, posts, accounts) seront perdues.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/orgs/${org.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Organisation supprimée');
    router.push('/admin/orgs');
  }

  return (
    <Card>
      <CardHeader><CardTitle>Paramètres organisation</CardTitle></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Nom</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Plan</Label>
          <select className="h-10 w-full rounded-md border px-3 text-sm" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="md:col-span-2 flex gap-2">
          <Button variant="brand" onClick={save} disabled={busy}>Enregistrer</Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>Supprimer l'organisation</Button>
        </div>
      </CardContent>
    </Card>
  );
}
