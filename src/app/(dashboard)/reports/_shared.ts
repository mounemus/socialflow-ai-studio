// Shared constants & types for the reporting UI.
// These MUST stay aligned with the sibling backend contract:
//   - prisma enums ReportPeriod / ReportFrequency / ReportStatus
//   - POST /api/reports + /api/reports/schedules zod schemas
//   - ReportingService.gatherData() output shape (Report.data)

// Period wire values = Prisma ReportPeriod enum members.
export type ReportPeriod =
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'LAST_MONTH'
  | 'LAST_QUARTER'
  | 'CUSTOM';

// Section keys are kebab-case, matching Report.sections (ReportingService).
export type ReportSectionKey =
  | 'overview'
  | 'engagement'
  | 'top-posts'
  | 'platforms'
  | 'competitors'
  | 'ai-summary';

export type ReportFrequency = 'ONCE' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
export type ReportStatus = 'DRAFT' | 'GENERATING' | 'READY' | 'FAILED';

export const PERIOD_LABEL: Record<ReportPeriod, string> = {
  LAST_7_DAYS: '7 derniers jours',
  LAST_30_DAYS: '30 derniers jours',
  LAST_90_DAYS: '90 derniers jours',
  LAST_MONTH: 'Mois dernier',
  LAST_QUARTER: 'Trimestre dernier',
  CUSTOM: 'Personnalisé',
};

export const SECTION_DEFS: { key: ReportSectionKey; label: string; description: string }[] = [
  { key: 'overview', label: "Vue d'ensemble", description: 'KPIs clés : publications, impressions, engagement, portée.' },
  { key: 'engagement', label: 'Engagement', description: "Évolution de l'engagement sur la période, par jour." },
  { key: 'top-posts', label: 'Top publications', description: 'Les publications les plus performantes du rapport.' },
  { key: 'platforms', label: 'Plateformes', description: 'Répartition des performances par réseau social.' },
  { key: 'competitors', label: 'Concurrents', description: 'Comparaison avec les concurrents suivis.' },
  { key: 'ai-summary', label: 'Résumé IA', description: 'Synthèse rédigée par l’IA : faits marquants & recommandations.' },
];

export const ALL_SECTION_KEYS: ReportSectionKey[] = SECTION_DEFS.map((s) => s.key);

export const FREQUENCY_LABEL: Record<ReportFrequency, string> = {
  ONCE: 'Une fois',
  WEEKLY: 'Hebdomadaire',
  MONTHLY: 'Mensuel',
  QUARTERLY: 'Trimestriel',
};

export const STATUS_LABEL: Record<ReportStatus, string> = {
  DRAFT: 'Brouillon',
  GENERATING: 'Génération…',
  READY: 'Prêt',
  FAILED: 'Échec',
};

export const STATUS_VARIANT: Record<ReportStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  DRAFT: 'secondary',
  GENERATING: 'info',
  READY: 'success',
  FAILED: 'destructive',
};

export type WhiteLabel = {
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  agencyName: string;
  footerText: string;
};

export const DEFAULT_WHITE_LABEL: WhiteLabel = {
  logoUrl: '',
  primaryColor: '#4f46e5',
  accentColor: '#06b6d4',
  agencyName: '',
  footerText: '',
};

// ---- Shape of Report.data produced by ReportingService.gatherData(). ----
export type ReportData = {
  meta?: { generatedAt?: string; periodLabel?: string; brandName?: string; orgName?: string };
  overview?: {
    totalPosts: number;
    totalImpressions: number;
    totalEngagement: number;
    totalReach: number;
    avgEngagementRate: number;
    deltaVsPrevious?: {
      impressions: number;
      engagement: number;
      reach: number;
      posts: number;
      engagementRatePct: number;
    };
  };
  engagement?: {
    timeseries?: { date: string; impressions: number; engagement: number }[];
    byType?: { likes: number; comments: number; shares: number };
  };
  topPosts?: {
    title: string;
    format?: string;
    platform?: string;
    impressions: number;
    engagement: number;
    engagementRate?: number;
    publishedAt?: string | null;
  }[];
  platforms?: {
    platform: string;
    posts: number;
    impressions: number;
    engagement: number;
    engagementRate?: number;
  }[];
  competitors?: { name: string; posts: number; avgEngagement: number }[];
};

export function readWhiteLabel(wl: Partial<WhiteLabel> | null | undefined): WhiteLabel {
  return { ...DEFAULT_WHITE_LABEL, ...(wl ?? {}) };
}
