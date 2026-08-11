'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { Megaphone, Plus, Send, Pencil, Trash2 } from 'lucide-react';

type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  brand: { id: string; name: string } | null;
  _count: { posts: number };
};
type BrandOption = { id: string; name: string };

const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: 'Brouillon', ACTIVE: 'Active', PAUSED: 'En pause', COMPLETED: 'Terminée', ARCHIVED: 'Archivée',
};
const STATUS_BADGE: Record<CampaignStatus, 'success' | 'secondary' | 'warning' | 'outline'> = {
  DRAFT: 'secondary', ACTIVE: 'success', PAUSED: 'warning', COMPLETED: 'outline', ARCHIVED: 'outline',
};

export function CampaignsClient({
  initialItems,
  brands,
  activeBrandId,
}: {
  initialItems: Campaign[];
  brands: BrandOption[];
  activeBrandId: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const [newBrandId, setNewBrandId] = useState(activeBrandId ?? '');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editObjective, setEditObjective] = useState('');
  const [editStatus, setEditStatus] = useState<CampaignStatus>('DRAFT');

  async function createCampaign() {
    if (!newName.trim()) {
      toast.error('Le nom est requis.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          objective: newObjective.trim() || undefined,
          brandId: newBrandId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Création impossible');
      const brand = brands.find((b) => b.id === newBrandId) ?? null;
      setItems((prev) => [{ ...json.data, brand, _count: { posts: 0 } }, ...prev]);
      setNewName(''); setNewObjective(''); setCreating(false);
      toast.success('Campagne créée.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: Campaign) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditObjective(c.objective ?? '');
    setEditStatus(c.status);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) {
      toast.error('Le nom est requis.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), objective: editObjective.trim() || undefined, status: editStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Modification impossible');
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...json.data } : c)));
      setEditingId(null);
      toast.success('Campagne modifiée.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCampaign(c: Campaign) {
    if (!confirm(`Supprimer la campagne « ${c.name} » ? Les publications liées ne seront pas supprimées.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Suppression impossible');
      setItems((prev) => prev.filter((x) => x.id !== c.id));
      toast.success('Campagne supprimée.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campagnes</h1>
          <p className="text-sm text-muted-foreground">Regroupe tes publications par campagne et objectif.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/campaigns/outreach"><Button variant="outline"><Send className="mr-2 h-4 w-4" /> Emailing & Messagerie</Button></Link>
          <Button variant="brand" onClick={() => setCreating((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" /> Nouvelle campagne
          </Button>
        </div>
      </div>

      {creating && (
        <Card>
          <CardHeader><CardTitle>Nouvelle campagne</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-name">Nom</Label>
                <Input id="c-name" value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Lancement rentrée" />
              </div>
              {brands.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="c-brand">Marque</Label>
                  <select
                    id="c-brand"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={newBrandId}
                    onChange={(e) => setNewBrandId(e.target.value)}
                  >
                    <option value="">Sans marque</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-objective">Objectif</Label>
              <Textarea id="c-objective" rows={3} value={newObjective} onChange={(e) => setNewObjective(e.target.value)}
                placeholder="Ex: Générer 50 inscriptions avant le 30 septembre" />
            </div>
            <div className="flex gap-2">
              <Button variant="brand" onClick={createCampaign} disabled={busy}>Créer</Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>Annuler</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState icon={<Megaphone className="h-10 w-10" />} title="Aucune campagne" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id}>
              {editingId === c.id ? (
                <CardContent className="space-y-3 pt-6">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nom" />
                  <Textarea rows={3} value={editObjective} onChange={(e) => setEditObjective(e.target.value)} placeholder="Objectif" />
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as CampaignStatus)}
                  >
                    {(Object.keys(STATUS_LABEL) as CampaignStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button size="sm" variant="brand" onClick={() => saveEdit(c.id)} disabled={busy}>Enregistrer</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={busy}>Annuler</Button>
                  </div>
                </CardContent>
              ) : (
                <>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>{c.name}</span>
                      <Badge variant={STATUS_BADGE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>{c.brand?.name ?? 'Sans marque'} · {c._count.posts} post{c._count.posts > 1 ? 's' : ''}</p>
                    {c.objective ? <p>Objectif: {c.objective}</p> : null}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
                        <Pencil className="mr-1 h-3 w-3" /> Modifier
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => deleteCampaign(c)}>
                        <Trash2 className="mr-1 h-3 w-3" /> Supprimer
                      </Button>
                    </div>
                  </CardContent>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
