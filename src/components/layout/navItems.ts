import {
  LayoutDashboard, Building2, Share2, Calendar, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, UserCog, Settings, CreditCard,
  Shield, UsersRound, Brain, Inbox, FileBarChart, GitBranch, ListTodo,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { href: string; icon: LucideIcon; label: string };
export type NavGroup = { title: string; items: readonly NavItem[] };

/**
 * Navigation Refonte Phase A — 4 espaces au lieu de 5, chacun répondant à UNE
 * question. Les URLs existantes sont toutes conservées : c'est un
 * regroupement, pas une réécriture (voir docs/REFONTE-PROPOSITION.md).
 *
 *   Cockpit — « Qu'est-ce qui demande mon attention maintenant ? »
 *   Marque  — « Qui est cette marque et quel est son plan ? »
 *   Studio  — « Que produit-on et quand part-il ? »
 *   Radar   — « Que se passe-t-il et qu'est-ce qui a marché ? »
 *
 * La marque active (sélecteur global de la Topbar) filtre les listes de tous
 * les espaces.
 */
export const groups: readonly NavGroup[] = [
  {
    title: 'Cockpit',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
      { href: '/intelligence', icon: Brain, label: 'Recommandations IA' },
      // Phase C : l'Assistant est ambiant (bouton flottant + Ctrl+K sur toutes
      // les pages) — /assistant reste servie, accessible depuis le panneau.
    ],
  },
  {
    title: 'Marque',
    items: [
      { href: '/brands', icon: Building2, label: 'Marques' },
      { href: '/pipelines', icon: GitBranch, label: 'Stratégie & pipeline' },
      { href: '/competitors', icon: Users, label: 'Concurrents' },
      { href: '/marketing-watch', icon: Radar, label: 'Veille' },
    ],
  },
  {
    title: 'Studio',
    items: [
      { href: '/studio', icon: Sparkles, label: 'Atelier créatif' },
      // Phase B : la File de production fusionne Publications + Validations.
      // Les anciennes URLs (/posts, /approvals) restent accessibles depuis
      // l'en-tête de la File (vue liste / historique).
      { href: '/production', icon: ListTodo, label: 'File de production' },
      { href: '/calendar', icon: Calendar, label: 'Calendrier' },
      { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
      { href: '/design-studio', icon: Palette, label: 'Design Studio' },
      { href: '/media-library', icon: ImageIcon, label: 'Médiathèque' },
      { href: '/automations', icon: Workflow, label: 'Automatisations' },
    ],
  },
  {
    title: 'Radar',
    items: [
      // Phase C : Conversations = Boîte de réception + Social Listening.
      // Les anciennes URLs /inbox et /listening restent servies.
      { href: '/conversations', icon: Inbox, label: 'Conversations' },
      { href: '/analytics', icon: BarChart3, label: 'Analytique' },
      { href: '/reports', icon: FileBarChart, label: 'Rapports' },
    ],
  },
];

/** Compat: liste plate (recherches, tests, anciens composants). */
export const items: readonly NavItem[] = groups.flatMap((g) => g.items);

export const secondary: readonly NavItem[] = [
  { href: '/social-accounts', icon: Share2, label: 'Comptes sociaux' },
  { href: '/settings/ai-models', icon: Sparkles, label: 'Modèles IA' },
  { href: '/clients', icon: UserCog, label: 'Clients' },
  { href: '/settings/team', icon: UsersRound, label: 'Équipe' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
  { href: '/billing', icon: CreditCard, label: 'Facturation' },
];

export const admin: readonly NavItem[] = [
  { href: '/admin', icon: Shield, label: 'Admin global' },
];
