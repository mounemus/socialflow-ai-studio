/**
 * Source UNIQUE du langage des statuts de publication — label, couleur (variant
 * de Badge), libellé court (chip calendrier) et colonne de production. Avant, la
 * Production, le Calendrier et la vue détail mappaient chacun les statuts à leur
 * façon (« Programmé » vs « OK » vs « info »…) : même post, trois vocabulaires.
 * Tout écran qui affiche un statut de post DOIT importer d'ici.
 */

export type BadgeVariant =
  | 'secondary'
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'outline';

export type ProductionColumnId =
  | 'idea'
  | 'draft'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'published';

export interface PostStatusMeta {
  /** Libellé complet (badge, en-têtes). */
  label: string;
  /** Couleur du badge. */
  variant: BadgeVariant;
  /** Libellé court pour les chips denses (calendrier). */
  short: string;
  /** Colonne du tableau de production (null = hors flux normal). */
  column: ProductionColumnId | null;
}

const META: Record<string, PostStatusMeta> = {
  IDEA: { label: 'Idée', variant: 'secondary', short: 'Idée', column: 'idea' },
  DRAFT: { label: 'Brouillon', variant: 'secondary', short: 'Brouillon', column: 'draft' },
  AI_GENERATED: { label: 'Généré par IA', variant: 'secondary', short: 'Brouillon', column: 'draft' },
  IN_DESIGN: { label: 'En design', variant: 'secondary', short: 'Design', column: 'draft' },
  DESIGN_LINKED: { label: 'Design lié', variant: 'secondary', short: 'Design', column: 'draft' },
  PENDING_APPROVAL: { label: 'En validation', variant: 'warning', short: 'À valider', column: 'review' },
  APPROVED: { label: 'Prêt à publier', variant: 'info', short: 'Prêt', column: 'approved' },
  SCHEDULED: { label: 'Programmé', variant: 'info', short: 'Programmé', column: 'scheduled' },
  QUEUED: { label: 'En file', variant: 'info', short: 'File', column: 'scheduled' },
  PUBLISHING: { label: 'Publication en cours', variant: 'info', short: 'Envoi', column: 'scheduled' },
  UPLOADING: { label: 'Envoi du média', variant: 'info', short: 'Upload', column: 'scheduled' },
  PROCESSING: { label: 'Traitement', variant: 'info', short: 'Traitement', column: 'scheduled' },
  PUBLISHED: { label: 'Publié', variant: 'success', short: 'Publié', column: 'published' },
  SIMULATED: { label: 'Publié (simulation)', variant: 'warning', short: 'Simulation', column: 'published' },
  FAILED: { label: 'Échec', variant: 'destructive', short: 'Échec', column: null },
  ACTION_REQUIRED: { label: 'Action requise', variant: 'warning', short: 'Action', column: null },
  MANUAL_SHARE_REQUIRED: { label: 'Partage manuel', variant: 'warning', short: 'Manuel', column: null },
  ARCHIVED: { label: 'Archivé', variant: 'secondary', short: 'Archivé', column: null },
};

const FALLBACK: PostStatusMeta = { label: 'Inconnu', variant: 'secondary', short: '—', column: null };

/** Métadonnées d'affichage d'un statut de post (toujours défini). */
export function postStatusMeta(status: string | null | undefined): PostStatusMeta {
  return (status && META[status]) || FALLBACK;
}

/**
 * Plateforme de base (INSTAGRAM…) déduite d'un SupportFormat (INSTAGRAM_POST…).
 * Le modèle `Post` ne stocke QUE `format`, pas `platform` — sans cette
 * dérivation, publier/programmer un post ne pouvait résoudre aucun compte
 * social (« aucun compte connecté » à tort). Source unique de ce mapping.
 */
export const PLATFORM_PREFIXES = [
  'FACEBOOK',
  'INSTAGRAM',
  'LINKEDIN',
  'TWITTER',
  'TIKTOK',
  'YOUTUBE',
  'PINTEREST',
] as const;

export function platformFromFormat(format: string | null | undefined): string | null {
  if (!format) return null;
  const f = String(format).toUpperCase();
  return PLATFORM_PREFIXES.find((p) => f.startsWith(p)) ?? null;
}

export interface ProductionColumn {
  id: ProductionColumnId;
  label: string;
  hint: string;
  statuses: string[];
}

/** Colonnes du tableau de production, dérivées de la même source de vérité. */
export const PRODUCTION_COLUMNS: readonly ProductionColumn[] = [
  { id: 'idea', label: 'Idées', hint: 'À développer' },
  { id: 'draft', label: 'Brouillons', hint: 'En cours d’écriture' },
  { id: 'review', label: 'En validation', hint: 'En attente d’approbation' },
  { id: 'approved', label: 'Prêts à publier', hint: 'À programmer ou publier' },
  { id: 'scheduled', label: 'Programmés', hint: 'Départ planifié' },
  { id: 'published', label: 'Publiés', hint: 'En ligne' },
].map((c) => ({
  ...c,
  statuses: Object.entries(META)
    .filter(([, m]) => m.column === c.id)
    .map(([status]) => status),
})) as ReadonlyArray<ProductionColumn>;
