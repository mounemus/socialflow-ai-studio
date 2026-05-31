/**
 * ReportDocument — a @react-pdf/renderer Document describing a white-label
 * social analytics report. Rendered server-side via renderReportPdf().
 *
 * It consumes the canonical `ReportData` produced by ReportingService.gatherData()
 * (see ../ReportingService.ts) plus an AI summary string and optional white-label
 * branding.
 *
 * IMPORTANT: this file uses @react-pdf/renderer primitives only (Document,
 * Page, View, Text, Image, StyleSheet). It is NOT DOM React — no HTML tags,
 * no react-dom. It runs in Node (Vercel serverless), no headless browser.
 */
import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import type { ReportData } from '../ReportingService';

export type { ReportData };

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface WhiteLabel {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
  agencyName?: string;
}

export interface ReportDocumentProps {
  data: ReportData;
  aiSummary: string;
  whiteLabel?: WhiteLabel;
}

/* -------------------------------------------------------------------------- */
/* Palette + helpers                                                           */
/* -------------------------------------------------------------------------- */

const DEFAULT_PRIMARY = '#7c3aed'; // violet
const DEFAULT_ACCENT = '#ec4899'; // pink
const INK = '#1f2937';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const HAIRLINE = '#e5e7eb';
const ZEBRA = '#f9fafb';
const SURFACE = '#ffffff';

interface Palette {
  primary: string;
  accent: string;
}

function resolvePalette(wl?: WhiteLabel): Palette {
  return {
    primary: wl?.primaryColor || DEFAULT_PRIMARY,
    accent: wl?.accentColor || DEFAULT_ACCENT,
  };
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat('fr-FR').format(Math.round(n));
}

/** Format an engagement rate. Values <= 1 are treated as fractions (0.034 -> 3.4%). */
function formatPct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function formatDelta(deltaPct: number | undefined | null): {
  label: string;
  arrow: string;
  up: boolean | null;
} {
  if (deltaPct === undefined || deltaPct === null || Number.isNaN(deltaPct)) {
    return { label: '—', arrow: '', up: null };
  }
  if (deltaPct === 0) return { label: '0%', arrow: '▬', up: null };
  const up = deltaPct > 0;
  return {
    label: `${up ? '+' : ''}${deltaPct.toFixed(1)}%`,
    arrow: up ? '▲' : '▼',
    up,
  };
}

function truncate(s: string | undefined | null, max: number): string {
  if (!s) return '—';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function formatDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return iso || '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                       */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: INK,
    backgroundColor: SURFACE,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 44,
    lineHeight: 1.4,
  },

  topBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
  },

  /* Cover */
  coverPage: {
    fontFamily: 'Helvetica',
    color: INK,
    backgroundColor: SURFACE,
    padding: 0,
  },
  coverBand: {
    paddingTop: 64,
    paddingBottom: 56,
    paddingHorizontal: 52,
  },
  coverLogo: {
    height: 44,
    maxWidth: 200,
    objectFit: 'contain',
    marginBottom: 28,
  },
  coverKicker: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  coverTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 32,
    color: '#ffffff',
    lineHeight: 1.15,
    marginBottom: 10,
  },
  coverBrand: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.92)',
  },
  coverBody: {
    paddingHorizontal: 52,
    paddingTop: 44,
  },
  coverMetaRow: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  coverMetaLabel: {
    width: 130,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: MUTED,
  },
  coverMetaValue: {
    flex: 1,
    fontSize: 12,
    color: INK,
  },
  coverRule: {
    height: 3,
    width: 64,
    marginTop: 8,
    marginBottom: 36,
  },
  coverFootnote: {
    position: 'absolute',
    bottom: 44,
    left: 52,
    right: 52,
    fontSize: 9,
    color: FAINT,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 12,
  },

  /* Section headings */
  sectionKicker: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 20,
    color: INK,
    marginBottom: 4,
  },
  sectionLead: {
    fontSize: 10,
    color: MUTED,
    marginBottom: 18,
  },
  headerRule: {
    height: 2,
    width: 48,
    marginBottom: 22,
  },

  /* Executive summary */
  summaryParagraph: {
    fontSize: 11.5,
    lineHeight: 1.65,
    color: '#374151',
    marginBottom: 12,
  },

  /* KPI tiles */
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  kpiTile: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  kpiCard: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 8,
    padding: 16,
    backgroundColor: SURFACE,
  },
  kpiAccentBar: {
    height: 4,
    width: 34,
    borderRadius: 2,
    marginBottom: 12,
  },
  kpiLabel: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 6,
  },
  kpiValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 26,
    color: INK,
  },
  kpiDeltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  kpiDeltaArrow: {
    fontSize: 9,
    marginRight: 4,
  },
  kpiDeltaText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  kpiDeltaCaption: {
    fontSize: 8,
    color: FAINT,
    marginLeft: 4,
  },

  /* Bar list */
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  barLabel: {
    width: 96,
    fontSize: 9,
    color: MUTED,
  },
  barTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 3,
    marginRight: 8,
  },
  barFill: {
    height: 12,
    borderRadius: 3,
  },
  barValue: {
    width: 56,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    textAlign: 'right',
  },

  /* Tables */
  table: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 6,
  },
  tHead: {
    flexDirection: 'row',
  },
  tHeadCell: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  tRowZebra: {
    backgroundColor: ZEBRA,
  },
  tCell: {
    fontSize: 9,
    color: '#374151',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  tCellStrong: {
    fontFamily: 'Helvetica-Bold',
    color: INK,
  },
  tCellRight: {
    textAlign: 'right',
  },

  subTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: INK,
    marginTop: 22,
    marginBottom: 10,
  },

  emptyNote: {
    fontSize: 10,
    color: FAINT,
    fontStyle: 'italic',
    paddingVertical: 12,
  },

  /* Footer */
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 8,
    color: FAINT,
  },
  footerCredit: {
    fontSize: 8,
    color: FAINT,
  },
});

/* -------------------------------------------------------------------------- */
/* Shared sub-components                                                       */
/* -------------------------------------------------------------------------- */

function Footer({ wl }: { wl?: WhiteLabel }) {
  const credit = wl?.agencyName ? wl.agencyName : 'Généré par SocialFlow AI';
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{wl?.footerText || ''}</Text>
      <Text
        style={styles.footerCredit}
        render={({ pageNumber, totalPages }) => `${credit}  ·  ${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

function SectionHeader({
  kicker,
  title,
  lead,
  palette,
}: {
  kicker: string;
  title: string;
  lead?: string;
  palette: Palette;
}) {
  return (
    <View>
      <Text style={[styles.sectionKicker, { color: palette.accent }]}>{kicker}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {lead ? <Text style={styles.sectionLead}>{lead}</Text> : null}
      <View style={[styles.headerRule, { backgroundColor: palette.primary }]} />
    </View>
  );
}

function ContentPage({
  children,
  wl,
  palette,
}: {
  children: React.ReactNode;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={[styles.topBand, { backgroundColor: palette.primary }]} fixed />
      {children}
      <Footer wl={wl} />
    </Page>
  );
}

function KpiTile({
  label,
  value,
  delta,
  palette,
}: {
  label: string;
  value: string;
  delta: ReturnType<typeof formatDelta>;
  palette: Palette;
}) {
  const deltaColor = delta.up === null ? MUTED : delta.up ? '#16a34a' : '#dc2626';
  return (
    <View style={styles.kpiTile}>
      <View style={styles.kpiCard}>
        <View style={[styles.kpiAccentBar, { backgroundColor: palette.accent }]} />
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={styles.kpiValue}>{value}</Text>
        <View style={styles.kpiDeltaRow}>
          {delta.arrow ? (
            <Text style={[styles.kpiDeltaArrow, { color: deltaColor }]}>{delta.arrow}</Text>
          ) : null}
          <Text style={[styles.kpiDeltaText, { color: deltaColor }]}>{delta.label}</Text>
          <Text style={styles.kpiDeltaCaption}>vs période préc.</Text>
        </View>
      </View>
    </View>
  );
}

/** Horizontal bar list where each row's fill is sized by value / max. */
function BarList({
  rows,
  color,
}: {
  rows: { label: string; value: number; display?: string }[];
  color: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View>
      {rows.map((r, i) => {
        const pct = Math.max(2, Math.round((r.value / max) * 100));
        return (
          <View style={styles.barRow} key={i}>
            <Text style={styles.barLabel}>{r.label}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
            </View>
            <Text style={styles.barValue}>{r.display ?? formatNumber(r.value)}</Text>
          </View>
        );
      })}
    </View>
  );
}

interface Column {
  key: string;
  header: string;
  flex: number;
  right?: boolean;
  strong?: boolean;
}

function Table({
  columns,
  rows,
  palette,
}: {
  columns: Column[];
  rows: Record<string, string>[];
  palette: Palette;
}) {
  return (
    <View style={styles.table}>
      <View style={[styles.tHead, { backgroundColor: palette.primary }]}>
        {columns.map((c) => (
          <Text
            key={c.key}
            style={[styles.tHeadCell, { flex: c.flex }, c.right ? styles.tCellRight : {}]}
          >
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View style={[styles.tRow, ri % 2 === 1 ? styles.tRowZebra : {}]} key={ri} wrap={false}>
          {columns.map((c) => (
            <Text
              key={c.key}
              style={[
                styles.tCell,
                { flex: c.flex },
                c.right ? styles.tCellRight : {},
                c.strong ? styles.tCellStrong : {},
              ]}
            >
              {row[c.key] ?? '—'}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                        */
/* -------------------------------------------------------------------------- */

function CoverPage({
  data,
  wl,
  palette,
}: {
  data: ReportData;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const credit = wl?.agencyName ? wl.agencyName : 'SocialFlow AI';
  const brandName = data.meta?.brandName;
  return (
    <Page size="A4" style={styles.coverPage}>
      <View style={[styles.coverBand, { backgroundColor: palette.primary }]}>
        {wl?.logoUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image style={styles.coverLogo} src={wl.logoUrl} />
        ) : null}
        <Text style={styles.coverKicker}>Rapport d&apos;analyse</Text>
        <Text style={styles.coverTitle}>Rapport de performance sociale</Text>
        {brandName ? <Text style={styles.coverBrand}>{brandName}</Text> : null}
      </View>

      <View style={styles.coverBody}>
        <View style={[styles.coverRule, { backgroundColor: palette.accent }]} />

        {brandName ? (
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Marque</Text>
            <Text style={styles.coverMetaValue}>{brandName}</Text>
          </View>
        ) : null}
        {data.meta?.orgName ? (
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Organisation</Text>
            <Text style={styles.coverMetaValue}>{data.meta.orgName}</Text>
          </View>
        ) : null}
        <View style={styles.coverMetaRow}>
          <Text style={styles.coverMetaLabel}>Période</Text>
          <Text style={styles.coverMetaValue}>{data.meta?.periodLabel || '—'}</Text>
        </View>
        <View style={styles.coverMetaRow}>
          <Text style={styles.coverMetaLabel}>Généré le</Text>
          <Text style={styles.coverMetaValue}>{formatDate(data.meta?.generatedAt)}</Text>
        </View>
        <View style={styles.coverMetaRow}>
          <Text style={styles.coverMetaLabel}>Préparé par</Text>
          <Text style={styles.coverMetaValue}>{credit}</Text>
        </View>
      </View>

      <Text style={styles.coverFootnote}>
        {wl?.footerText || `Document confidentiel · ${credit}`}
      </Text>
    </Page>
  );
}

function SummaryPage({
  aiSummary,
  wl,
  palette,
}: {
  aiSummary: string;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const paragraphs = (aiSummary || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return (
    <ContentPage wl={wl} palette={palette}>
      <SectionHeader
        kicker="Synthèse"
        title="Résumé exécutif"
        lead="Analyse générée par l'IA des temps forts de la période."
        palette={palette}
      />
      {paragraphs.length ? (
        paragraphs.map((p, i) => (
          <Text style={styles.summaryParagraph} key={i}>
            {p}
          </Text>
        ))
      ) : (
        <Text style={styles.emptyNote}>Aucun résumé disponible pour cette période.</Text>
      )}
    </ContentPage>
  );
}

function KpiPage({
  data,
  wl,
  palette,
}: {
  data: ReportData;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const o = data.overview;
  const d = o?.deltaVsPrevious;
  return (
    <ContentPage wl={wl} palette={palette}>
      <SectionHeader
        kicker="Vue d'ensemble"
        title="Indicateurs clés"
        lead="Les chiffres essentiels de la période, avec leur évolution."
        palette={palette}
      />
      <View style={styles.kpiGrid}>
        <KpiTile
          label="Impressions"
          value={formatNumber(o?.totalImpressions)}
          delta={formatDelta(d?.impressions)}
          palette={palette}
        />
        <KpiTile
          label="Engagement"
          value={formatNumber(o?.totalEngagement)}
          delta={formatDelta(d?.engagement)}
          palette={palette}
        />
        <KpiTile
          label="Portée (reach)"
          value={formatNumber(o?.totalReach)}
          delta={formatDelta(d?.reach)}
          palette={palette}
        />
        <KpiTile
          label="Taux d'engagement moyen"
          value={formatPct(o?.avgEngagementRate)}
          delta={formatDelta(d?.engagementRatePct)}
          palette={palette}
        />
      </View>
    </ContentPage>
  );
}

function EngagementPage({
  data,
  wl,
  palette,
}: {
  data: ReportData;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const ts = data.engagement?.timeseries ?? [];
  const byType = data.engagement?.byType;

  // Sample the timeseries down to at most ~14 rows for a compact bar view.
  const sampled = ts.length > 14 ? ts.filter((_, i) => i % Math.ceil(ts.length / 14) === 0) : ts;

  const byTypeRows = byType
    ? [
        { type: "J'aime", value: byType.likes },
        { type: 'Commentaires', value: byType.comments },
        { type: 'Partages', value: byType.shares },
      ]
    : [];

  return (
    <ContentPage wl={wl} palette={palette}>
      <SectionHeader
        kicker="Performance"
        title="Engagement & impressions"
        lead="Évolution sur la période et répartition des interactions."
        palette={palette}
      />

      <Text style={styles.subTitle}>Impressions par jour</Text>
      {sampled.length ? (
        <BarList
          rows={sampled.map((p) => ({ label: p.date, value: p.impressions }))}
          color={palette.primary}
        />
      ) : (
        <Text style={styles.emptyNote}>Aucune donnée temporelle disponible.</Text>
      )}

      <Text style={styles.subTitle}>Répartition des interactions</Text>
      {byTypeRows.some((r) => r.value > 0) ? (
        <BarList
          rows={byTypeRows.map((r) => ({ label: r.type, value: r.value }))}
          color={palette.accent}
        />
      ) : (
        <Text style={styles.emptyNote}>Aucune interaction enregistrée.</Text>
      )}
    </ContentPage>
  );
}

function TopPostsPage({
  data,
  wl,
  palette,
}: {
  data: ReportData;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const posts = (data.topPosts ?? []).slice(0, 5);
  return (
    <ContentPage wl={wl} palette={palette}>
      <SectionHeader
        kicker="Contenus"
        title="Top 5 des publications"
        lead="Les publications les plus performantes de la période."
        palette={palette}
      />
      {posts.length ? (
        <Table
          palette={palette}
          columns={[
            { key: 'title', header: 'Publication', flex: 5, strong: true },
            { key: 'platform', header: 'Plateforme', flex: 2 },
            { key: 'impressions', header: 'Impr.', flex: 2, right: true },
            { key: 'engagement', header: 'Engag.', flex: 2, right: true },
            { key: 'er', header: 'TE', flex: 2, right: true },
          ]}
          rows={posts.map((p) => ({
            title: truncate(p.title, 46),
            platform: p.platform || '—',
            impressions: formatNumber(p.impressions),
            engagement: formatNumber(p.engagement),
            er: formatPct(p.engagementRate),
          }))}
        />
      ) : (
        <Text style={styles.emptyNote}>Aucune publication à afficher.</Text>
      )}
    </ContentPage>
  );
}

function PlatformsPage({
  data,
  wl,
  palette,
}: {
  data: ReportData;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const rows = data.platforms ?? [];
  return (
    <ContentPage wl={wl} palette={palette}>
      <SectionHeader
        kicker="Canaux"
        title="Performance par plateforme"
        lead="Comparatif des résultats par réseau social."
        palette={palette}
      />
      {rows.length ? (
        <>
          <BarList
            rows={rows.map((r) => ({ label: r.platform, value: r.impressions }))}
            color={palette.accent}
          />
          <View style={{ height: 8 }} />
          <Table
            palette={palette}
            columns={[
              { key: 'platform', header: 'Plateforme', flex: 3, strong: true },
              { key: 'posts', header: 'Posts', flex: 2, right: true },
              { key: 'impressions', header: 'Impressions', flex: 3, right: true },
              { key: 'engagement', header: 'Engagement', flex: 3, right: true },
              { key: 'er', header: 'Taux eng.', flex: 2, right: true },
            ]}
            rows={rows.map((r) => ({
              platform: r.platform,
              posts: formatNumber(r.posts),
              impressions: formatNumber(r.impressions),
              engagement: formatNumber(r.engagement),
              er: formatPct(r.engagementRate),
            }))}
          />
        </>
      ) : (
        <Text style={styles.emptyNote}>Aucune donnée par plateforme disponible.</Text>
      )}
    </ContentPage>
  );
}

function CompetitorsPage({
  data,
  wl,
  palette,
}: {
  data: ReportData;
  wl?: WhiteLabel;
  palette: Palette;
}) {
  const rows = data.competitors ?? [];
  if (!rows.length) return null;
  return (
    <ContentPage wl={wl} palette={palette}>
      <SectionHeader
        kicker="Marché"
        title="Analyse concurrentielle"
        lead="Positionnement des concurrents suivis sur la période."
        palette={palette}
      />
      <Table
        palette={palette}
        columns={[
          { key: 'name', header: 'Concurrent', flex: 5, strong: true },
          { key: 'posts', header: 'Publications', flex: 3, right: true },
          { key: 'avgEngagement', header: 'Engag. moyen / post', flex: 4, right: true },
        ]}
        rows={rows.map((r) => ({
          name: r.name,
          posts: formatNumber(r.posts),
          avgEngagement: formatNumber(r.avgEngagement),
        }))}
      />
    </ContentPage>
  );
}

/* -------------------------------------------------------------------------- */
/* Document                                                                     */
/* -------------------------------------------------------------------------- */

export function ReportDocument({ data, aiSummary, whiteLabel }: ReportDocumentProps) {
  const palette = resolvePalette(whiteLabel);
  const author = whiteLabel?.agencyName || 'SocialFlow AI';
  return (
    <Document
      title="Rapport de performance sociale"
      author={author}
      creator={author}
      producer="SocialFlow AI"
      subject={data.meta?.brandName ? `Rapport — ${data.meta.brandName}` : 'Rapport social'}
    >
      <CoverPage data={data} wl={whiteLabel} palette={palette} />
      <SummaryPage aiSummary={aiSummary} wl={whiteLabel} palette={palette} />
      <KpiPage data={data} wl={whiteLabel} palette={palette} />
      <EngagementPage data={data} wl={whiteLabel} palette={palette} />
      <TopPostsPage data={data} wl={whiteLabel} palette={palette} />
      <PlatformsPage data={data} wl={whiteLabel} palette={palette} />
      <CompetitorsPage data={data} wl={whiteLabel} palette={palette} />
    </Document>
  );
}

export default ReportDocument;
