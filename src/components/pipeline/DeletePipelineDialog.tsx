'use client';

import { useEffect } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Confirmation de suppression d'un pipeline — remplace les DEUX
 * `window.confirm` empilés qui piégeaient l'utilisateur : au second dialogue,
 * « Annuler » (et Échap) ne renonçait PAS, il supprimait quand même le
 * pipeline en gardant seulement les publications. Ici, trois choix explicites
 * et une vraie sortie à tout moment (Échap, clic hors du panneau, Annuler).
 */
export function DeletePipelineDialog({
  open,
  terminal,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Run terminé/annulé : suppression définitive (sinon : annulation du run). */
  terminal: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (purgePosts: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-pipeline-title"
        className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="delete-pipeline-title" className="text-base font-semibold">
            {terminal ? 'Supprimer ce pipeline ?' : 'Annuler ce pipeline ?'}
          </h2>
          <button
            type="button"
            aria-label="Fermer"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          La marque et son profil sont conservés. Que faire des publications
          générées par ce pipeline&nbsp;? Les publications déjà <b>publiées</b> sont
          conservées dans tous les cas.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onConfirm(false)}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {terminal ? 'Supprimer le pipeline, garder les publications' : 'Annuler le pipeline, garder les publications'}
          </Button>
          <Button
            variant="outline"
            className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            disabled={busy}
            onClick={() => onConfirm(true)}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Tout supprimer (publications non publiées incluses)
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Ne rien faire
          </Button>
        </div>
      </div>
    </div>
  );
}
