'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, KeyRound, ToggleLeft, ToggleRight, Shield } from 'lucide-react';

type User = {
  id: string;
  email: string;
  name: string | null;
  globalRole: string;
  disabled: boolean;
  createdAt: string;
  memberships: { organization: { id: string; name: string } }[];
  _count: { createdPosts: number; aiRequests: number; agentRuns: number };
};

type Org = { id: string; name: string };

const ROLES = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER'] as const;
const ORG_ROLES = ['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER'] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [create, setCreate] = useState({
    email: '', name: '', password: '',
    globalRole: 'OWNER',
    createOrganization: false, organizationName: '',
    attachToOrganizationId: '', attachWithRole: 'EDITOR' as string,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    const res = await fetch(`/api/admin/users${params}`);
    if (res.ok) setUsers((await res.json()).data);
  }
  async function loadOrgs() {
    const res = await fetch('/api/admin/orgs-list');
    if (res.ok) setOrgs((await res.json()).data);
  }
  useEffect(() => { load(); loadOrgs(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(create),
    });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); return toast.error(j.message ?? 'Erreur'); }
    const { data } = await res.json();
    if (data.initialPassword) {
      navigator.clipboard.writeText(`Email: ${create.email}\nPassword: ${data.initialPassword}`);
      toast.success(`Compte créé. Mot de passe généré copié dans le presse-papier.`);
    } else {
      toast.success('Compte créé');
    }
    setShowCreate(false);
    setCreate({ email: '', name: '', password: '', globalRole: 'OWNER', createOrganization: false, organizationName: '', attachToOrganizationId: '', attachWithRole: 'EDITOR' });
    load();
  }

  async function resetPassword(userId: string) {
    if (!confirm('Réinitialiser le mot de passe ? Un nouveau sera généré et copié.')) return;
    setBusy(userId);
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    const { data } = await res.json();
    navigator.clipboard.writeText(`Password: ${data.newPassword}`);
    toast.success('Nouveau mot de passe copié dans le presse-papier');
  }

  async function toggleDisable(u: User) {
    setBusy(u.id);
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled: !u.disabled }),
    });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    toast.success(u.disabled ? 'Compte réactivé' : 'Compte désactivé');
    load();
  }

  async function setGlobalRole(u: User, role: string) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ globalRole: role }),
    });
    if (!res.ok) return toast.error('Erreur');
    toast.success('Rôle global mis à jour');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">Tous les comptes de la plateforme. Création, désactivation, reset password, rôle global.</p>
        </div>
        <Button variant="brand" onClick={() => setShowCreate((s) => !s)}>
          <UserPlus className="mr-2 h-4 w-4" /> Nouveau compte
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Créer un compte</CardTitle>
            <CardDescription>Si tu laisses le mot de passe vide, on en génère un et il est copié dans ton presse-papier.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitCreate} className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1"><Label>Email</Label><Input type="email" required value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} /></div>
              <div className="space-y-1"><Label>Nom</Label><Input required value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Mot de passe (optionnel, min 8)</Label><Input type="password" minLength={8} value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} placeholder="auto-généré si vide" /></div>
              <div className="space-y-1">
                <Label>Rôle global</Label>
                <select className="h-10 w-full rounded-md border px-3 text-sm" value={create.globalRole} onChange={(e) => setCreate({ ...create, globalRole: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div className="md:col-span-2 border-t pt-3 mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={create.createOrganization} onChange={(e) => setCreate({ ...create, createOrganization: e.target.checked })} />
                  Créer une nouvelle organisation pour ce compte
                </label>
              </div>
              {create.createOrganization ? (
                <div className="space-y-1 md:col-span-2">
                  <Label>Nom de l'organisation</Label>
                  <Input value={create.organizationName} onChange={(e) => setCreate({ ...create, organizationName: e.target.value })} />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Attacher à une organisation existante (optionnel)</Label>
                    <select className="h-10 w-full rounded-md border px-3 text-sm" value={create.attachToOrganizationId} onChange={(e) => setCreate({ ...create, attachToOrganizationId: e.target.value })}>
                      <option value="">— aucune —</option>
                      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Rôle dans cette org</Label>
                    <select className="h-10 w-full rounded-md border px-3 text-sm" value={create.attachWithRole} onChange={(e) => setCreate({ ...create, attachWithRole: e.target.value })}>
                      {ORG_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </>
              )}

              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" variant="brand" disabled={busy === 'create'}>{busy === 'create' ? '...' : 'Créer'}</Button>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{users.length} utilisateurs</span>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher email/nom..." className="h-8 w-64 pl-7 text-xs" />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Nom</th>
                <th className="px-4 py-2 text-left">Rôle global</th>
                <th className="px-4 py-2 text-left">Orgs</th>
                <th className="px-4 py-2 text-right">Posts</th>
                <th className="px-4 py-2 text-right">Agent</th>
                <th className="px-4 py-2 text-center">Statut</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{u.email}</td>
                  <td className="px-4 py-2">{u.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <select className="rounded border px-2 py-1 text-xs" value={u.globalRole} onChange={(e) => setGlobalRole(u, e.target.value)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-xs">{u.memberships.map((m) => m.organization.name).join(', ') || '—'}</td>
                  <td className="px-4 py-2 text-right">{u._count.createdPosts}</td>
                  <td className="px-4 py-2 text-right">{u._count.agentRuns}</td>
                  <td className="px-4 py-2 text-center">
                    <Badge variant={u.disabled ? 'destructive' : 'success'}>{u.disabled ? 'Off' : 'On'}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => resetPassword(u.id)} disabled={busy === u.id} title="Réinitialiser mdp">
                        <KeyRound className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleDisable(u)} disabled={busy === u.id} title={u.disabled ? 'Activer' : 'Désactiver'}>
                        {u.disabled ? <ToggleLeft className="h-3 w-3" /> : <ToggleRight className="h-3 w-3" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
