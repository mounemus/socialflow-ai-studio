'use client';
import Link from 'next/link';
import { Search, Bell } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OrgSwitcher } from './OrgSwitcher';
import { MobileNav } from './MobileNav';

export function Topbar({ userEmail, isSuperAdmin = false }: { userEmail?: string; isSuperAdmin?: boolean }) {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <MobileNav isSuperAdmin={isSuperAdmin} />
        <OrgSwitcher />
        <div className="relative hidden md:block">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher posts, marques, comptes..." className="h-9 w-80 pl-8" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
        <Link href="/settings" className="hidden text-sm text-slate-700 hover:text-slate-900 sm:inline">
          {userEmail ?? 'Compte'}
        </Link>
      </div>
    </header>
  );
}
