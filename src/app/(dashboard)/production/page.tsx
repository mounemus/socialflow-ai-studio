import Link from 'next/link';
import { ProductionBoardClient } from './ProductionBoardClient';

export const dynamic = 'force-dynamic';

/**
 * File de production (Refonte Phase B) — vue pivot du Studio.
 *
 * Le cycle de vie du Post rendu visible en colonnes :
 *   Idées → Brouillons → En validation → Validés → Programmés → Publiés
 *
 * Fusionne les anciennes pages Publications (liste) et Validations (file
 * d'approbation) : valider est une étape, pas un lieu. Les deux anciennes
 * URLs restent accessibles (vue liste détaillée / historique d'approbation).
 */
export default function ProductionPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">File de production</h1>
          <p className="text-sm text-muted-foreground">
            Tout le contenu de la marque active, de l’idée à la publication. Glisse ou clique pour faire avancer.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/posts" className="text-muted-foreground underline-offset-2 hover:underline">
            Vue liste
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/approvals" className="text-muted-foreground underline-offset-2 hover:underline">
            Historique des validations
          </Link>
        </div>
      </div>
      <ProductionBoardClient />
    </div>
  );
}
