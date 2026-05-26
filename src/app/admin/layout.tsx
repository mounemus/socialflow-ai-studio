import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Shield, Building2, Users, KeyRound, Bot, ArrowLeft, Activity, Plug } from 'lucide-react';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');
  const user = await db.user.findUnique({ where: { id: userId }, select: { globalRole: true, email: true } });
  if (user?.globalRole !== 'SUPER_ADMIN') redirect('/dashboard');

  const navItems = [
    { href: '/admin', icon: Shield, label: 'Overview' },
    { href: '/admin/orgs', icon: Building2, label: 'Organisations' },
    { href: '/admin/users', icon: Users, label: 'Utilisateurs' },
    { href: '/admin/connections', icon: Plug, label: 'Intégrations' },
    { href: '/admin/api-keys', icon: KeyRound, label: 'Toutes les API Keys' },
    { href: '/admin/agent', icon: Bot, label: 'Agent IA' },
    { href: '/admin/system', icon: Activity, label: 'Système & Audit' },
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50">
      <aside className="hidden w-64 flex-col border-r bg-card lg:flex">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="text-lg font-bold text-rose-600">Super-Admin</div>
          <Link href="/dashboard" className="text-xs text-slate-500 hover:text-slate-900">
            <ArrowLeft className="h-3 w-3 inline" /> Sortir
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {navItems.map((it) => {
            const Icon = it.icon;
            return (
              <Link key={it.href} href={it.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-700">
                <Icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-4 text-xs text-slate-500">
          Connecté : {user.email}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
