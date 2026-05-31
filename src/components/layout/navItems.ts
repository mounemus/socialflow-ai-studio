import {
  LayoutDashboard, Building2, Share2, Calendar, FileText, Sparkles, Palette, Image as ImageIcon,
  Megaphone, Radar, Users, Workflow, BarChart3, CheckCircle2, UserCog, Settings, CreditCard,
  Bot, Shield, UsersRound, Brain, Inbox, FileBarChart, Ear,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { href: string; icon: LucideIcon; label: string };

export const items: readonly NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { href: '/brands', icon: Building2, label: 'Marques' },
  { href: '/social-accounts', icon: Share2, label: 'Comptes sociaux' },
  { href: '/calendar', icon: Calendar, label: 'Calendrier' },
  { href: '/inbox', icon: Inbox, label: 'Boîte de réception' },
  { href: '/posts', icon: FileText, label: 'Publications' },
  { href: '/design-studio', icon: Palette, label: 'Design Studio' },
  { href: '/ai-studio', icon: Sparkles, label: 'Studio IA (texte)' },
  { href: '/pipelines', icon: Workflow, label: 'Pipelines' },
  { href: '/intelligence', icon: Brain, label: 'Intelligence' },
  { href: '/assistant', icon: Bot, label: 'Assistant IA' },
  { href: '/media-library', icon: ImageIcon, label: 'Médiathèque' },
  { href: '/campaigns', icon: Megaphone, label: 'Campagnes' },
  { href: '/marketing-watch', icon: Radar, label: 'Veille' },
  { href: '/listening', icon: Ear, label: 'Social Listening' },
  { href: '/competitors', icon: Users, label: 'Concurrents' },
  { href: '/automations', icon: Workflow, label: 'Automatisations' },
  { href: '/analytics', icon: BarChart3, label: 'Analytique' },
  { href: '/reports', icon: FileBarChart, label: 'Rapports' },
  { href: '/approvals', icon: CheckCircle2, label: 'Validations' },
  { href: '/clients', icon: UserCog, label: 'Clients' },
];

export const secondary: readonly NavItem[] = [
  { href: '/settings/team', icon: UsersRound, label: 'Équipe' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
  { href: '/billing', icon: CreditCard, label: 'Facturation' },
];

export const admin: readonly NavItem[] = [
  { href: '/admin', icon: Shield, label: 'Admin global' },
];
