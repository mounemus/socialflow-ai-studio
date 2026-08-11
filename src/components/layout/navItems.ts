import {
  LayoutDashboard, Building2, Share2, Calendar, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, UserCog, Settings, CreditCard,
  Shield, UsersRound, Brain, Inbox, FileBarChart, ListTodo, Wand2, Target, GitBranch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { href: string; icon: LucideIcon; label: string };
export type NavGroup = { title: string; items: readonly NavItem[] };

/**
 * Navigation organisée par MOMENT du flux de travail — chaque section répond
 * à une question, dans l'ordre où on se la pose. Toutes les URLs existantes
 * sont conservées.
 *
 *   Espace de travail     — le quotidien : créer → produire → planifier →
 *                           répondre → capital créatif.
 *   Stratégie & croissance — préparer et amplifier : d'où vient le contenu,
 *                           comment il se démultiplie.
 *   Mesure & veille       — comprendre : ce qui a marché, ce qui se dit,
 *                           ce que font les autres.
 *   Configuration         — la structure : marques, connexions, clients,
 *                           équipe, réglages.
 *
 * La marque active (sélecteur en tête de la Sidebar, « ESPACE DE MARQUE »)
 * filtre les listes de tous les espaces.
 */
export const groups: readonly NavGroup[] = [
  {
    title: 'Espace de travail',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Accueil' },
      { href: '/create', icon: Wand2, label: 'Créer' },
      { href: '/production', icon: ListTodo, label: 'Production' },
      { href: '/calendar', icon: Calendar, label: 'Calendrier' },
      // Quotidien par nature (badge non-lus) — remonté du « Pilotage ».
      { href: '/conversations', icon: Inbox, label: 'Conversations' },
      { href: '/media-library', icon: ImageIcon, label: 'Bibliothèque' },
    ],
  },
  {
    title: 'Stratégie & croissance',
    items: [
      // Accès direct : /strategy redirige vers la stratégie de la marque active.
      { href: '/strategy', icon: Target, label: 'Stratégie' },
      { href: '/pipelines', icon: GitBranch, label: 'Pipelines' },
      { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
      { href: '/automations', icon: Workflow, label: 'Automatisations' },
      { href: '/intelligence', icon: Brain, label: 'Recommandations IA' },
    ],
  },
  {
    title: 'Mesure & veille',
    items: [
      { href: '/analytics', icon: BarChart3, label: 'Analytique' },
      { href: '/reports', icon: FileBarChart, label: 'Rapports' },
      { href: '/marketing-watch', icon: Radar, label: 'Veille' },
      { href: '/competitors', icon: Users, label: 'Concurrents' },
    ],
  },
];

/**
 * Section « Outils » repliable — vidée : tout a été reclassé par moment de
 * travail. Conservée (vide) pour compat d'import ; la Sidebar ne la rend
 * plus quand elle est vide.
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
