'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Building2, Share2, Calendar, FileText, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, CheckCircle2, UserCog, Settings, CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard', icon: LayoutDashboard, key: 'dashboard' },
  { href: '/brands', icon: Building2, key: 'brands' },
  { href: '/social-accounts', icon: Share2, key: 'socialAccounts' },
  { href: '/calendar', icon: Calendar, key: 'calendar' },
  { href: '/posts', icon: FileText, key: 'posts' },
  { href: '/ai-studio', icon: Sparkles, key: 'aiStudio' },
  { href: '/canva-studio', icon: Palette, key: 'canvaStudio' },
  { href: '/media-library', icon: ImageIcon, key: 'mediaLibrary' },
  { href: '/campaigns', icon: Megaphone, key: 'campaigns' },
  { href: '/marketing-watch', icon: Radar, key: 'marketingWatch' },
  { href: '/competitors', icon: Users, key: 'competitors' },
  { href: '/automations', icon: Workflow, key: 'automations' },
  { href: '/analytics', icon: BarChart3, key: 'analytics' },
  { href: '/approvals', icon: CheckCircle2, key: 'approvals' },
  { href: '/clients', icon: UserCog, key: 'clients' },
] as const;

const secondary = [
  { href: '/settings', icon: Settings, key: 'settings' },
  { href: '/billing', icon: CreditCard, key: 'billing' },
] as const;

export function Sidebar() {
  const path = usePathname();
  const t = useTranslations('nav');
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
                  {t(it.key)}
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
                  {t(it.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
