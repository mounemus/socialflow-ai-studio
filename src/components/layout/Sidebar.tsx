'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Building2, Share2, Calendar, FileText, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, CheckCircle2, UserCog, Settings, CreditCard,
  Bot, Shield, UsersRound, Brain, Inbox, FileBarChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { href: '/brands', icon: Building2, label: 'Marques' },
  { href: '/social-accounts', icon: Share2, label: 'Comptes sociaux' },
  { href: '/calendar', icon: Calendar, label: 'Calendrier' },
  { href: '/inbox', icon: Inbox, label: 'Boîte de réception' },
  { href: '/posts', icon: FileText, label: 'Publications' },
  { href: '/ai-studio', icon: Sparkles, label: 'Studio IA' },
  { href: '/pipelines', icon: Workflow, label: 'Pipelines' },
  { href: '/intelligence', icon: Brain, label: 'Intelligence' },
  { href: '/assistant', icon: Bot, label: 'Assistant IA' },
  { href: '/canva-studio', icon: Palette, label: 'Studio Canva' },
  { href: '/media-library', icon: ImageIcon, label: 'Médiathèque' },
  { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
  { href: '/marketing-watch', icon: Radar, label: 'Veille' },
  { href: '/competitors', icon: Users, label: 'Concurrents' },
  { href: '/automations', icon: Workflow, label: 'Automatisations' },
  { href: '/analytics', icon: BarChart3, label: 'Analytique' },
  { href: '/reports', icon: FileBarChart, label: 'Rapports' },
  { href: '/approvals', icon: CheckCircle2, label: 'Validations' },
  { href: '/clients', icon: UserCog, label: 'Clients' },
] as const;

const secondary = [
  { href: '/settings/team', icon: UsersRound, label: 'Équipe' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
  { href: '/billing', icon: CreditCard, label: 'Facturation' },
] as const;

const admin = [
  { href: '/admin', icon: Shield, label: 'Admin global' },
] as const;

export function Sidebar({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const path = usePathname();
  // useTranslations imported but not used here; keep ready for future i18n.
  useTranslations('nav');
  const [unreadCount, setUnreadCount] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/inbox/unread-count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled && typeof data.count === 'number') setUnreadCount(data.count);
      } catch {
        // ignore
      }
    };
    void fetchUnread();
    const id = window.setInterval(fetchUnread, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
      <div className="flex h-16 items-center px-6">
        <Link href="/dashboard" className="text-lg font-bold">
          SocialFlow <span className="text-brand-600">AI</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {items.map((it) => {
            const active = path === it.href || path.startsWith(it.href + '/');
            const Icon = it.icon;
            const showBadge = it.href === '/inbox' && unreadCount > 0;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{it.label}</span>
                  {showBadge ? (
                    <span
                      className={cn(
                        'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        active ? 'bg-white/20 text-white' : 'bg-brand-600 text-white',
                      )}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="my-4 border-t" />
        <ul className="space-y-1">
          {secondary.map((it) => {
            const active = path === it.href || path.startsWith(it.href + '/');
            const Icon = it.icon;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {isSuperAdmin ? (
          <>
            <div className="my-4 border-t" />
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Super-admin</div>
            <ul className="space-y-1">
              {admin.map((it) => {
                const active = path === it.href || path.startsWith(it.href + '/');
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active ? 'bg-rose-600 text-white' : 'text-rose-700 hover:bg-rose-50',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </nav>
    </aside>
  );
}
