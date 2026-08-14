'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Copy, Trash2 } from 'lucide-react';

const ROLES = ['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER'] as const;

type Member = {
  id: string; role: string;
  user: { id: string; email: string; name: string | null; image: string | null; disabled: boolean; createdAt: string };
};

type Invite = { id: string; email: string; role: string; expiresAt: string; createdAt: string; acceptUrl?: string };

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [form, setForm] = useState({ email: '', role: 'EDITOR' });
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const [m, i] = await Promise.all([
      fetch('/api/team/members').then((r) => r.json()),
      fetch('/api/team/invites').then((r) => r.json()),
    ]);
    setMembers(m.data ?? []);
    setInvites(i.data ?? []);
  }
  useEffect(() => { refresh(); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/team/invites', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur');
    }
    const { data } = await res.json();
    if (data.acceptUrl) {
      navigator.clipboard.writeText(data.acceptUrl);
      toast.success('Lien d\'invitation copié dans le presse-papier');
    } else {
      toast.success('Invitation envoyée');
    }
    setForm({ email: '', role: 'EDITOR' });
    refresh();
  }

  // État busy partagé : sans lui, le sélecteur de rôle et les corbeilles
  // restaient cliquables pendant la requête (double-clic = double action).
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  async function updateRole(memberId: string, role: string) {
    setActionBusy(memberId);
    try {
      const res = await fetch(`/api/team/members/${memberId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); return toast.error(j.message ?? 'Mise à jour du rôle impossible'); }
      toast.success('Rôle mis à jour');
      refresh();
    } finally {
      setActionBusy(null);
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm('Retirer ce membre de l\'organisation ?')) return;
    setActionBusy(memberId);
    try {
      const res = await fetch(`/api/team/members/${memberId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); return toast.error(j.message ?? 'Retrait impossible'); }
      toast.success('Membre retiré');
      refresh();
    } finally {
      setActionBusy(null);
    }
  }

  async function revokeInvite(inviteId: string) {
    setActionBusy(inviteId);
    try {
      const res = await fetch(`/api/team/invites/${inviteId}`, { method: 'DELETE' });
      // Un échec était totalement MUET (pas de else) : clic sans réaction.
      if (!res.ok) { const j = await res.json().catch(() => ({})); return toast.error(j.message ?? 'Révocation impossible'); }
      toast.success('Invitation révoquée');
      refresh();
    } finally {
      setActionBusy(null);
    }
  }

  function copyLink(token: string) {
    const url = `${location.origin}/accept-invite?token=${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Lien copié');
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Équipe</h1>
        <p className="text-sm text-muted-foreground">Gérer les membres de l'organisation et les invitations.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inviter un membre</CardTitle>
          <CardDescription>L'utilisateur recevra un lien d'invitation valable 7 jours. Le lien est aussi copié dans ton presse-papier.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label>Email</Label>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1 sm:w-48">
              <Label>Rôle</Label>
              <select className="h-10 w-full rounded-md border px-3 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <Button type="submit" variant="brand" disabled={loading}>{loading ? '...' : 'Inviter'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Membres ({members.length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{m.user.name ?? m.user.email}</div>
                  <div className="text-xs text-muted-foreground">{m.user.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select className="rounded-md border px-2 py-1 text-sm" value={m.role} disabled={actionBusy === m.id} onChange={(e) => updateRole(m.id, e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Button variant="ghost" size="icon" disabled={actionBusy === m.id} onClick={() => removeMember(m.id)} aria-label="Retirer">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {invites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitations en attente ({invites.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      <Badge variant="secondary">{i.role}</Badge>
                      <span className="ml-2">Expire le {new Date(i.expiresAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyLink((i as { token?: string }).token ?? '')}><Copy className="mr-1 h-3 w-3" /> Copier le lien</Button>
                    <Button variant="ghost" size="icon" disabled={actionBusy === i.id} onClick={() => revokeInvite(i.id)} aria-label="Révoquer l'invitation"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
