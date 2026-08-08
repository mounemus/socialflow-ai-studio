/**
 * Source UNIQUE du langage des pipelines « 5 Actes » — statut (RUNNING…) et
 * étape (CREATE_BRAND…) en libellés humains + couleur de badge. Pendant du
 * fichier post-status.ts, côté stratégie IA. Tout écran qui affiche un statut
 * ou une étape de pipeline (dashboard, /create, PipelineRunner) DOIT importer
 * d'ici — fini les enums bruts « AWAITING_ADMIN » / « VALIDATE_STRATEGY_ITEMS »
 * montrés tels quels à l'utilisateur.
 */

import type { BadgeVariant } from './post-status';

export interface PipelineStatusMeta {
  label: string;
  variant: BadgeVariant;
}

const STATUS: Record<string, PipelineStatusMeta> = {
  RUNNING: { label: 'En cours', variant: 'info' },
  AWAITING_ADMIN: { label: 'À valider', variant: 'warning' },
  PAUSED: { label: 'En pause', variant: 'secondary' },
  COMPLETED: { label: 'Terminé', variant: 'success' },
  FAILED: { label: 'Échec', variant: 'destructive' },
  CANCELLED: { label: 'Annulé', variant: 'destructive' },
};

const STATUS_FALLBACK: PipelineStatusMeta = { label: 'Inconnu', variant: 'secondary' };

export function pipelineStatusMeta(status: string | null | undefined): PipelineStatusMeta {
  return (status && STATUS[status]) || STATUS_FALLBACK;
}

/** Libellés humains des 7 étapes de la machine à états. */
const STEP_LABELS: Record<string, string> = {
  CREATE_BRAND: 'Déclaration de marque',
  ENRICH_PROFILE: 'Enrichissement du profil',
  VALIDATE_PROFILE: 'Validation du profil',
  GENERATE_STRATEGY: 'Génération de stratégie',
  VALIDATE_STRATEGY_ITEMS: 'Validation de la stratégie',
  EXECUTE_ITEMS: 'Concrétisation',
  DONE: 'Terminé',
};

export function pipelineStepLabel(step: string | null | undefined): string {
  return (step && STEP_LABELS[step]) || step || '—';
}
