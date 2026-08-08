import {
  LayoutDashboard, Building2, Share2, Calendar, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, UserCog, Settings, CreditCard,
  Shield, UsersRound, Brain, Inbox, FileBarChart, ListTodo, Wand2, Target, GitBranch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { href: string; icon: LucideIcon; label: string };
export type NavGroup = { title: string; items: readonly NavItem[] };

/**
 * Navigation Refonte « Orbit » — le quotidien tient dans UN espace de travail
 * de six verbes, les vues de pilotage à part, et le reste dans une section
 * Outils repliée. Les URLs existantes sont toutes conservées.
 *
 *   Espace de travail — le flux quotidien : idée → stratégie → création →
 *                       production → planification → capital créatif.
 *   Pilotage          — ce qui se passe et ce qui a marché.
 *   Outils            — les instruments spécialisés, accessibles mais
 *                       silencieux (repliés par défaut).
 *
 * La marque active (sélecteur en tête de la Sidebar, « ESPACE DE MARQUE »)
 * filtre les listes de tous les espaces.
 */
export const groups: readonly NavGroup[] = [
  {
    title: 'Espace de travail',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Accueil' },
      // Point d'entrée unique de création : IA (pipeline stratégie) OU manuel
      // (Studio). Remplace les deux entrées « Stratégie » et « Studio » qui
      // éparpillaient le « par où commencer ». Les URLs /pipelines et /studio
      // restent valides, atteignables depuis /create.
      { href: '/create', icon: Wand2, label: 'Créer' },
      { href: '/production', icon: ListTodo, label: 'Production' },
      { href: '/calendar', icon: Calendar, label: 'Calendrier' },
      { href: '/media-library', icon: ImageIcon, label: 'Bibliothèque' },
    ],
  },
  {
    title: 'Pilotage',
    items: [
      // Accès direct : /strategy redirige vers la stratégie de la marque active.
      { href: '/strategy', icon: Target, label: 'Stratégie' },
      { href: '/pipelines', icon: GitBranch, label: 'Pipelines' },
      { href: '/conversations', icon: Inbox, label: 'Conversations' },
      { href: '/analytics', icon: BarChart3, label: 'Analytique' },
      { href: '/brands', icon: Building2, label: 'Marques' },
      { href: '/social-accounts', icon: Share2, label: 'Connexions' },
    ],
  },
];

/** Section « Outils » — repliée par défaut dans la Sidebar. */
export const tools: readonly NavItem[] = [
  { href: '/intelligence', icon: Brain, label: 'Recommandations IA' },
  { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
  // Design Studio a fusionné dans l'atelier unifié (/studio, onglet Visuel) —
  // retiré de la nav pour éviter le doublon ; la page reste joignable par URL
  // avec sa bannière de migration.
  { href: '/automations', icon: Workflow, label: 'Automatisations' },
  { href: '/competitors', icon: Users, label: 'Concurrents' },
  { href: '/marketing-watch', icon: Radar, label: 'Veille' },
  { href: '/reports', icon: FileBarChart, label: 'Rapports' },
];

/** Compat: liste plate (recherches, tests, anciens composants). */
export const items: readonly NavItem[] = [...groups.flatMap((g) => g.items), ...tools];

export const secondary: readonly NavItem[] = [
  { href: '/settings/ai-models', icon: Sparkles, label: 'Modèles IA' },
  { href: '/clients', icon: UserCog, label: 'Clients' },
  { href: '/settings/team', icon: UsersRound, label: 'Équipe' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
  { href: '/billing', icon: CreditCard, label: 'Facturation' },
];

export const admin: readonly NavItem[] = [
  { href: '/admin', icon: Shield, label: 'Admin global' },
];
