'use client';
import Link from 'next/link';
import { OrgSwitcher } from './OrgSwitcher';
import { MobileNav } from './MobileNav';

/**
 * Topbar Refonte « Orbit » : épurée — la marque active vit dans la Sidebar
 * (« ESPACE DE MARQUE »), la Topbar ne garde que l'organisation et le compte.
 *
 * La barre de recherche et la cloche de notifications ont été RETIRÉES : ni
 * l'une ni l'autre n'avaient de comportement (aucun handler) — deux contrôles
 * factices présents sur toutes les pages qui promettaient des fonctions
 * inexistantes. À rebrancher le jour où une vraie recherche globale existe.
 */
export function Topbar({ userEmail, isSuperAdmin = false }: { userEmail?: string; isSuperAdmin?: boolean }) {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <MobileNav isSuperAdmin={isSuperAdmin} />
        <OrgSwitcher />
      </div>
      <div className="flex items-center gap-3">
        <Link href="/settings" className="hidden text-sm text-foreground/80 hover:text-foreground sm:inline">
          {userEmail ?? 'Compte'}
        </Link>
      </div>
    </header>
  );
}
