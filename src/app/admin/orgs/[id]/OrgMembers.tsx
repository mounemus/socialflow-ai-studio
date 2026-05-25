'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, UserPlus } from 'lucide-react';

const ROLES = ['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER'] as const;

type Member = { id: string; role: string; user: { id: string; email: string; name: string | null; disabled: boolean } };
type UserOption = { id: string; email: string; name: string | null };

export function OrgMembers({ organizationId, members, allUsers }: {
  organizationId: string;
  members: Member[];
  allUsers: UserOption[];
}) {
  const router = useRouter();
  const [add, setAdd] = useState({ userId: '', role: 'EDITOR' });
  const [busy, setBusy] = useState<string | null>(null);

  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = allUsers.filter((u) => !memberIds.has(u.id));

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!add.userId) return;
    setBusy('add');
    const res = await fetch(`/api/admin/orgs/${organizationId}/members`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(add),
    });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Membre ajouté');
    setAdd({ userId: '', role: 'EDITOR' });
    router.refresh();
  }

  async function changeRole(memberId: string, role: string) {
    const res = await fetch(`/api/admin/orgs/${organizationId}/members/${memberId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }),
    });
    if (!res.ok) return toast.error('Erreur');
    toast.success('Rôle mis à jour');
    router.refresh();
  }

  async function removeMember(memberId: string) {
    if (!confirm('Retirer ce membre ?')) return;
    setBusy(memberId);
    const res = await fetch(`/api/admin/orgs/${organizationId}/members/${memberId}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Retiré');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Équipe ({members.length})</CardTitle>
        <CardDescription>Membres et rôles dans cette organisation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={addMember} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <div className="flex-1 min-w-[16rem]">
            <label className="text-xs text-muted-foreground">Ajouter un utilisateur existant</label>
            <select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })}>
              <option value="">— sélectionner —</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>)}
            </select>
          </div>
          <div className="w-40">
            <label className="text-xs text-muted-foreground">Rôle</label>
            <select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <Button type="submit" variant="brand" disabled={!add.userId || busy === 'add'}>
            <UserPlus className="mr-1 h-3 w-3" /> Ajouter
          </Button>
        </form>

        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-sm">{m.user.name ?? m.user.email}</div>
                <div className="text-xs text-muted-foreground">{m.user.email}{m.user.disabled ? ' · ⚠️ désactivé' : ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <select className="rounded border px-2 py-1 text-xs" value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Button variant="ghost" size="icon" onClick={() => removeMember(m.id)} disabled={busy === m.id}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
