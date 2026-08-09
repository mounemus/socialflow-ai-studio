'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BrandPipelineStatus } from '@prisma/client';

const TERMINAL: BrandPipelineStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Bouton de suppression/annulation par carte sur la liste des pipelines.
 * Nichè dans le <Link> de la carte : preventDefault + stopPropagation
 * empêchent la navigation avant l'ouverture de la confirmation.
 */
export function PipelineCardActions({
  id,
  status,
}: {
  id: string;
  status: BrandPipelineStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isTerminal = TERMINAL.includes(status);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const confirmText = isTerminal
      ? 'Supprimer définitivement ce pipeline ?'
      : 'Annuler ce pipeline ?';
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pipelines/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(json?.message ?? 'Suppression impossible');
        return;
      }
      toast.success(isTerminal ? 'Pipeline supprimé' : 'Pipeline annulé');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
      onClick={handleDelete}
      disabled={busy}
      title={isTerminal ? 'Supprimer définitivement' : 'Annuler'}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
