import {
  LayoutDashboard, Building2, Share2, Calendar, FileText, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, CheckCircle2, UserCog, Settings, CreditCard,
  Bot, Shield, UsersRound, Brain, Inbox, FileBarChart, Ear, GitBranch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { href: string; icon: LucideIcon; label: string };
export type NavGroup = { title: string; items: readonly NavItem[] };

/**
 * Navigation en 5 espaces (Accueil / Planifier / Créer / Engager / Mesurer).
 * Les URLs existantes sont conservées — seul le regroupement change.
 * Comptes sociaux, clients, équipe, facturation → espace Paramètres (secondary).
 */
export const groups: readonly NavGroup[] = [
  {
    title: 'Accueil',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
      { href: '/brands', icon: Building2, label: 'Marques' },
      { href: '/assistant', icon: Bot, label: 'Assistant IA' },
    ],
  },
  {
    title: 'Planifier',
    items: [
      { href: '/pipelines', icon: GitBranch, label: 'Stratégie & pipeline' },
      { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
      { href: '/calendar', icon: Calendar, label: 'Calendrier' },
      { href: '/automations', icon: Workflow, label: 'Automatisations' },
    ],
  },
  {
    title: 'Créer',
    items: [
      { href: '/posts', icon: FileText, label: 'Publications' },
      { href: '/design-studio', icon: Palette, label: 'Design Studio' },
      { href: '/ai-studio', icon: Sparkles, label: 'Studio IA (texte)' },
      { href: '/media-library', icon: ImageIcon, label: 'Médiathèque' },
      { href: '/approvals', icon: CheckCircle2, label: 'Validations' },
    ],
  },
  {
    title: 'Engager',
    items: [
      { href: '/inbox', icon: Inbox, label: 'Boîte de réception' },
      { href: '/listening', icon: Ear, label: 'Social Listening' },
      { href: '/marketing-watch', icon: Radar, label: 'Veille' },
      { href: '/competitors', icon: Users, label: 'Concurrents' },
    ],
  },
  {
    title: 'Mesurer',
    items: [
      { href: '/analytics', icon: BarChart3, label: 'Analytique' },
      { href: '/reports', icon: FileBarChart, label: 'Rapports' },
      { href: '/intelligence', icon: Brain, label: 'Recommandations IA' },
    ],
  },
];

/** Compat: liste plate (recherches, tests, anciens composants). */
export const items: readonly NavItem[] = groups.flatMap((g) => g.items);

export const secondary: readonly NavItem[] = [
  { href: '/social-accounts', icon: Share2, label: 'Comptes sociaux' },
  { href: '/clients', icon: UserCog, label: 'Clients' },
  { href: '/settings/team', icon: UsersRound, label: 'Équipe' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
  { href: '/billing', icon: CreditCard, label: 'Facturation' },
];

export const admin: readonly NavItem[] = [
  { href: '/admin', icon: Shield, label: 'Admin global' },
];
