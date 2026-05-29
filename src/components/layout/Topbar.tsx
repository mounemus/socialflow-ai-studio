'use client';
import Link from 'next/link';
import { Search, Bell } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OrgSwitcher } from './OrgSwitcher';

export function Topbar({ userEmail }: { userEmail?: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-3">
        <OrgSwitcher />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher posts, marques, comptes..." className="h-9 w-80 pl-8" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
        <Link href="/settings" className="text-sm text-slate-700 hover:text-slate-900">
          {userEmail ?? 'Compte'}
        </Link>
      </div>
    </header>
  );
}
