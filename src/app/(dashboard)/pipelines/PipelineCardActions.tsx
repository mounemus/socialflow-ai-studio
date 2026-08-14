'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeletePipelineDialog } from '@/components/pipeline/DeletePipelineDialog';
import type { BrandPipelineStatus } from '@prisma/client';

const TERMINAL: BrandPipelineStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Bouton de suppression/annulation par carte sur la liste des pipelines.
 * Niché dans le <Link> de la carte : preventDefault + stopPropagation
 * empêchent la navigation avant l'ouverture de la confirmation.
 * Le double `window.confirm` piégeux est remplacé par un vrai dialogue à
 * trois choix (voir DeletePipelineDialog).
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
  const [open, setOpen] = useState(false);
  const isTerminal = TERMINAL.includes(status);

  async function confirmDelete(purge: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/pipelines/${id}${purge ? '?purgePosts=1' : ''}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(json?.message ?? 'Suppression impossible');
        return;
      }
      toast.success(isTerminal ? 'Pipeline supprimé' : 'Pipeline annulé');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={busy}
        title={isTerminal ? 'Supprimer définitivement' : 'Annuler'}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
      <DeletePipelineDialog
        open={open}
        terminal={isTerminal}
        busy={busy}
        onClose={() => !busy && setOpen(false)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
