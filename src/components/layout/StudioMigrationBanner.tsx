import Link from 'next/link';
import { Sparkles } from 'lucide-react';

/**
 * Bannière de migration douce : les anciens studios restent fonctionnels,
 * mais le parcours recommandé est l'Atelier créatif unifié (/studio).
 */
export function StudioMigrationBanner({ from }: { from: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-600/30 bg-brand-600/5 px-3 py-2 text-sm">
      <Sparkles className="h-4 w-4 shrink-0 text-brand-600" />
      <span>
        {from} rejoint l’<strong>Atelier créatif</strong> — le nouveau parcours unifié Brief → Texte →
        Visuel → Canva → Validation → Diffusion.
      </span>
      <Link href="/studio" className="ml-auto shrink-0 font-medium text-brand-600 hover:underline">
        Ouvrir l’atelier →
      </Link>
    </div>
  );
}
