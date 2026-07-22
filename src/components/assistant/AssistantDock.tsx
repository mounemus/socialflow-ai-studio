'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Maximize2, X } from 'lucide-react';
import { AssistantChat } from './AssistantChat';

/**
 * Assistant ambiant (Refonte Phase C) — accessible depuis TOUTES les pages :
 *   · bouton flottant en bas à droite ;
 *   · raccourci Ctrl+K / ⌘K (Échap pour fermer).
 *
 * Le panneau garde sa conversation tant qu'il reste monté (il est rendu dans
 * le layout du dashboard) : ouvrir/fermer ne perd jamais le fil. « Plein
 * écran » renvoie vers la page /assistant historique.
 */
export function AssistantDock() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Bouton flottant — toujours visible, au-dessus du contenu. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Assistant IA (Ctrl+K)"
        title="Assistant IA (Ctrl+K)"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <Bot className="h-5 w-5" />
      </button>

      {/* Panneau latéral — masqué (pas démonté) pour préserver la conversation. */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-white shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="false"
        aria-label="Assistant IA"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-brand-600" /> Assistant IA
            <kbd className="rounded border bg-slate-50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Ctrl+K
            </kbd>
          </span>
          <span className="flex items-center gap-1">
            <Link
              href="/assistant"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Ouvrir l'assistant en pleine page"
              title="Pleine page"
            >
              <Maximize2 className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <AssistantChat compact />
        </div>
      </div>
    </>
  );
}
