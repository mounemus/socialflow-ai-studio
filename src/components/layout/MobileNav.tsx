'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groups, tools, secondary, admin, type NavItem } from './navItems';
import { useUnreadCount } from './useUnreadCount';

export function MobileNav({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const unreadCount = useUnreadCount();

  // Close the drawer whenever the route changes (after a link is selected).
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Prevent body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const renderLink = (it: NavItem, variant: 'default' | 'admin' = 'default') => {
    const active = path === it.href || path.startsWith(it.href + '/');
    const Icon = it.icon;
    const showBadge = (it.href === '/conversations' || it.href === '/inbox') && unreadCount > 0;
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          onClick={() => setOpen(false)}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            variant === 'admin'
              ? active
                ? 'bg-rose-600 text-white'
                : 'text-rose-700 hover:bg-rose-50'
              : active
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100',
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
  };

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col border-r bg-card shadow-xl"
          >
            <div className="flex h-16 items-center justify-between px-6">
              <Link
                href="/dashboard"
                className="text-lg font-bold"
                onClick={() => setOpen(false)}
              >
                SocialFlow <span className="text-brand-600">AI</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-2">
              {groups.map((g) => (
                <div key={g.title} className="mb-3">
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {g.title}
                  </div>
                  <ul className="space-y-1">{g.items.map((it) => renderLink(it))}</ul>
                </div>
              ))}
              <div className="mb-3">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Outils
                </div>
                <ul className="space-y-1">{tools.map((it) => renderLink(it))}</ul>
              </div>
              <div className="my-4 border-t" />
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Paramètres
              </div>
              <ul className="space-y-1">{secondary.map((it) => renderLink(it))}</ul>
              {isSuperAdmin ? (
                <>
                  <div className="my-4 border-t" />
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Super-admin
                  </div>
                  <ul className="space-y-1">{admin.map((it) => renderLink(it, 'admin'))}</ul>
                </>
              ) : null}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
