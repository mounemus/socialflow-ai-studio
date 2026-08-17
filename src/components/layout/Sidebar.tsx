'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groups, tools, secondary, admin, type NavItem } from './navItems';
import { BrandSwitcher } from './BrandSwitcher';
import { useUnreadCount } from './useUnreadCount';

const NAV_GROUPS_KEY = 'nav.groups';

/**
 * Sidebar Refonte « Orbit » : panneau sombre (encre verte #20241f), marque
 * active en tête (« ESPACE DE MARQUE »), navigation en 6 espaces repliables
 * (état persisté dans localStorage sous `nav.groups`) et une section Outils
 * repliée par défaut. L'espace contenant la page courante reste forcé ouvert.
 */
export function Sidebar({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const path = usePathname();
  // useTranslations imported but not used here; keep ready for future i18n.
  useTranslations('nav');
  const unreadCount = useUnreadCount();
  const toolsActive = tools.some((it) => path === it.href || path.startsWith(it.href + '/'));
  const [toolsOpen, setToolsOpen] = useState(toolsActive);

  // Ouvert par défaut au premier rendu (SSR-safe) ; l'état sauvegardé n'est
  // appliqué qu'après le montage pour éviter un mismatch d'hydratation.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAV_GROUPS_KEY);
      if (raw) setOpenGroups(JSON.parse(raw));
    } catch {
      // localStorage indisponible ou JSON invalide — tout reste ouvert
    }
  }, []);

  const activeGroupTitle = groups.find((g) =>
    g.items.some((it) => path === it.href || path.startsWith(it.href + '/')),
  )?.title;

  const isGroupOpen = (title: string) => title === activeGroupTitle || openGroups[title] !== false;

  const toggleGroup = (title: string) => {
    const next = { ...openGroups, [title]: !isGroupOpen(title) };
    setOpenGroups(next);
    try {
      window.localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible — l'état reste en mémoire pour la session
    }
  };

  const renderItem = (it: NavItem) => {
    const active = path === it.href || path.startsWith(it.href + '/');
    const Icon = it.icon;
    const showBadge = (it.href === '/conversations' || it.href === '/inbox') && unreadCount > 0;
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            active
              ? 'bg-white/10 font-medium text-white'
              : 'text-[#aeb3aa] hover:bg-white/5 hover:text-white',
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="flex-1">{it.label}</span>
          {showBadge ? (
            <span className="ml-auto rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  const groupTitle = (title: string) => (
    <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777970]">
      {title}
    </div>
  );

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-[hsl(var(--sidebar))] lg:flex">
      <div className="flex h-16 items-center px-6">
        <Link href="/dashboard" className="text-lg font-bold text-white">
          SocialFlow <span className="text-brand-500">AI</span>
        </Link>
      </div>

      {/* La marque est le contexte : elle vit en tête, au-dessus de la nav. */}
      <div className="px-4 pb-3">
        {groupTitle('Espace de marque')}
        <div className="px-1">
          <BrandSwitcher variant="dark" />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((g) => {
          const open = isGroupOpen(g.title);
          return (
            <div key={g.title} className="mb-4">
              <button
                type="button"
                onClick={() => toggleGroup(g.title)}
                title={g.hint}
                aria-expanded={open}
                className="flex w-full items-center gap-1 rounded-lg px-3 pb-1 pt-1 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777970] hover:text-white"
              >
                <span className="flex-1">{g.title}</span>
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              </button>
              {open ? <ul className="space-y-0.5">{g.items.map(renderItem)}</ul> : null}
            </div>
          );
        })}

        {/* Outils spécialisés — section vidée par la réorganisation, rendue
            seulement si elle retrouve un contenu un jour. */}
        {tools.length > 0 ? (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setToolsOpen((o) => !o)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#aeb3aa] transition-colors hover:bg-white/5 hover:text-white"
              aria-expanded={toolsOpen}
            >
              <Wrench className="h-4 w-4" />
              <span className="flex-1 text-left">Outils</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', toolsOpen && 'rotate-180')} />
            </button>
            {toolsOpen ? <ul className="mt-0.5 space-y-0.5">{tools.map(renderItem)}</ul> : null}
          </div>
        ) : null}

        <div className="my-4 border-t border-white/10" />
        {groupTitle('Réglages')}
        <ul className="space-y-0.5">{secondary.map(renderItem)}</ul>
        {isSuperAdmin ? (
          <>
            <div className="my-4 border-t border-white/10" />
            {groupTitle('Super-admin')}
            <ul className="space-y-0.5">
              {admin.map((it) => {
                const active = path === it.href || path.startsWith(it.href + '/');
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active ? 'bg-rose-500/20 text-rose-200' : 'text-rose-300/80 hover:bg-white/5 hover:text-rose-200',
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
