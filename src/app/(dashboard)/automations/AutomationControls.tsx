'use client';

/** Contrôles d'une automatisation : activer/pause, exécuter maintenant, supprimer. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Play, Pause, Zap, Trash2, Loader2 } from 'lucide-react';

export function AutomationControls({ id, name, status }: { id: string; name: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(action: 'toggle' | 'run' | 'delete') {
    setBusy(action);
    try {
      if (action === 'delete') {
        if (!window.confirm(`Supprimer l'automatisation « ${name} » et son historique ?`)) return;
        const res = await fetch(`/api/automations/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Suppression impossible');
        toast.success('Automatisation supprimée.');
      } else if (action === 'toggle') {
        const next = status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        const res = await fetch(`/api/automations/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error('Changement de statut impossible');
        toast.success(next === 'ACTIVE'
          ? 'Activée — le déclencheur sera évalué toutes les 10 minutes.'
          : 'Mise en pause.');
      } else {
        const res = await fetch(`/api/automations/${id}/run`, { method: 'POST' });
        const json = await res.json().catch(() => null);
        if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Exécution échouée');
        toast.success(json?.data?.pendingApproval
          ? 'Exécutée — un post attend ta validation dans Approbations.'
          : 'Exécutée avec succès.');
      }
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void call('toggle')}>
        {busy === 'toggle' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : status === 'ACTIVE' ? <Pause className="mr-1 h-3 w-3" /> : <Play className="mr-1 h-3 w-3" />}
        {status === 'ACTIVE' ? 'Pause' : 'Activer'}
      </Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void call('run')}
        title="Exécute toutes les étapes maintenant (la publication attend l'approbation humaine)">
        {busy === 'run' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />}
        Exécuter
      </Button>
      <button type="button" title="Supprimer" disabled={busy !== null}
        onClick={() => void call('delete')} className="rounded p-1.5 hover:bg-slate-100">
        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}
