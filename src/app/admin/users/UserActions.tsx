'use client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function UserActions({ userId, disabled, globalRole }: { userId: string; disabled: boolean; globalRole: string }) {
  const router = useRouter();

  async function toggle() {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: !disabled }),
    });
    if (!res.ok) return toast.error('Erreur');
    toast.success(disabled ? 'Utilisateur réactivé' : 'Utilisateur désactivé');
    router.refresh();
  }

  async function promote() {
    const newRole = globalRole === 'SUPER_ADMIN' ? 'OWNER' : 'SUPER_ADMIN';
    if (!confirm(`Changer le rôle global vers ${newRole} ?`)) return;
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ globalRole: newRole }),
    });
    if (!res.ok) return toast.error('Erreur');
    toast.success('Rôle global mis à jour');
    router.refresh();
  }

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={promote} className="text-xs">
        {globalRole === 'SUPER_ADMIN' ? 'Rétrograder' : 'Promouvoir SA'}
      </Button>
      <Button variant="ghost" size="sm" onClick={toggle} className="text-xs">
        {disabled ? 'Réactiver' : 'Désactiver'}
      </Button>
    </div>
  );
}
