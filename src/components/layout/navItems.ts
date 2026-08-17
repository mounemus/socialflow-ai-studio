import {
  LayoutDashboard, Building2, Share2, Calendar, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, UserCog, Settings, CreditCard,
  Shield, UsersRound, Brain, Inbox, FileBarChart, ListTodo, Wand2, Target, GitBranch,
  UserSearch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { href: string; icon: LucideIcon; label: string };
export type NavGroup = { title: string; items: readonly NavItem[]; hint?: string };

/**
 * Navigation organisée en 6 espaces, chacun répondant à une question :
 *
 *   Accueil       — Qu'est-ce qui demande mon attention ?
 *   Plan          — Quel est le plan de cette marque ?
 *   Contenus      — Que produit-on, quand part-il ?
 *   Conversations — Que dit-on de nous ?
 *   Croissance    — Comment trouver des clients ?
 *   Mesure        — Qu'est-ce qui a marché ?
 *
 * La marque active (sélecteur en tête de la Sidebar, « ESPACE DE MARQUE »)
 * filtre les listes de tous les espaces. Toutes les URLs existantes sont
 * conservées ; seuls le regroupement et les libellés changent.
 */
export const groups: readonly NavGroup[] = [
  {
    title: 'Accueil',
    hint: "Qu'est-ce qui demande mon attention ?",
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Accueil' },
    ],
  },
  {
    title: 'Plan',
    hint: 'Quel est le plan de cette marque ?',
    items: [
      { href: '/strategy', icon: Target, label: 'Stratégie' },
      { href: '/pipelines', icon: GitBranch, label: 'Pipelines' },
      { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
    ],
  },
  {
    title: 'Contenus',
    hint: 'Que produit-on, quand part-il ?',
    items: [
      { href: '/create', icon: Wand2, label: 'Créer' },
      { href: '/studio', icon: Palette, label: 'Atelier' },
      // Les validations sont désormais une colonne de la file de production,
      // pas une entrée de nav séparée — la route /approvals reste active.
      { href: '/production', icon: ListTodo, label: 'File de production' },
      { href: '/calendar', icon: Calendar, label: 'Calendrier' },
      { href: '/media-library', icon: ImageIcon, label: 'Bibliothèque' },
    ],
  },
  {
    title: 'Conversations',
    hint: 'Que dit-on de nous ?',
    items: [
      { href: '/conversations', icon: Inbox, label: 'Conversations' },
    ],
  },
  {
    title: 'Croissance',
    hint: 'Comment trouver des clients ?',
    items: [
      { href: '/prospecting', icon: UserSearch, label: 'Prospection' },
      { href: '/automations', icon: Workflow, label: 'Automatisations' },
    ],
  },
  {
    title: 'Mesure',
    hint: "Qu'est-ce qui a marché ?",
    items: [
      { href: '/analytics', icon: BarChart3, label: 'Analytique' },
      { href: '/reports', icon: FileBarChart, label: 'Rapports' },
      { href: '/marketing-watch', icon: Radar, label: 'Veille' },
      { href: '/competitors', icon: Users, label: 'Concurrents' },
      { href: '/intelligence', icon: Brain, label: 'Recommandations IA' },
    ],
  },
];

/**
 * Section « Outils » repliable — vidée : tout a été reclassé par espace.
 * Conservée (vide) pour compat d'import ; la Sidebar ne la rend plus quand
 * elle est vide.
 */
export const tools: readonly NavItem[] = [];

/** Compat: liste plate (recherches, tests, anciens composants). */
export const items: readonly NavItem[] = [...groups.flatMap((g) => g.items), ...tools];

export const secondary: readonly NavItem[] = [
  // La structure de l'espace : marques et connexions sont de la configuration,
  // pas du pilotage quotidien.
  { href: '/brands', icon: Building2, label: 'Marques' },
  { href: '/social-accounts', icon: Share2, label: 'Connexions' },
  { href: '/clients', icon: UserCog, label: 'Clients' },
  { href: '/settings/team', icon: UsersRound, label: 'Équipe' },
  { href: '/settings/ai-models', icon: Sparkles, label: 'Modèles IA' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
  { href: '/billing', icon: CreditCard, label: 'Facturation' },
];

export const admin: readonly NavItem[] = [
  { href: '/admin', icon: Shield, label: 'Admin global' },
];
