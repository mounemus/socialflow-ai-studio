/**
 * renderReportPdf — server-side helper that renders a white-label analytics
 * report to a PDF Buffer using @react-pdf/renderer.
 *
 * Works in Vercel serverless (Node runtime) — @react-pdf/renderer renders to a
 * buffer in pure JS, no headless Chromium required.
 *
 * NOTE: the calling route must use the Node.js runtime (the default for route
 * handlers), not the Edge runtime.
 */
import React from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { ReportDocument } from './ReportDocument';
import type { ReportData } from '../ReportingService';
import type { WhiteLabel } from './ReportDocument';

export type { ReportData, WhiteLabel };

export interface RenderReportPdfOptions {
  /**
   * The full Report row (optional). The route passes it for convenience/logging;
   * the actual rendering only needs `data`, `aiSummary` and `whiteLabel`.
   */
  report?: unknown;
  /** Computed report data — the shape produced by ReportingService.gatherData(). */
  data: ReportData;
  /** AI-generated executive summary (may be null when no summary was produced). */
  aiSummary?: string | null;
  /** White-label branding. Comes from Report.whiteLabel (a Prisma Json field). */
  whiteLabel?: WhiteLabel | null | Record<string, unknown>;
}

/** Narrow a loose Json-ish value into the WhiteLabel shape we care about. */
function coerceWhiteLabel(wl: RenderReportPdfOptions['whiteLabel']): WhiteLabel | undefined {
  if (!wl || typeof wl !== 'object') return undefined;
  const o = wl as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return {
    logoUrl: str(o.logoUrl),
    primaryColor: str(o.primaryColor),
    accentColor: str(o.accentColor),
    footerText: str(o.footerText),
    agencyName: str(o.agencyName),
  };
}

export async function renderReportPdf(opts: RenderReportPdfOptions): Promise<Buffer> {
  const { data, aiSummary, whiteLabel } = opts;

  const element = React.createElement(ReportDocument, {
    data,
    aiSummary: aiSummary ?? '',
    whiteLabel: coerceWhiteLabel(whiteLabel),
  });

  // ReportDocument renders a <Document> at its root; cast so renderToBuffer's
  // ReactElement<DocumentProps> signature is satisfied.
  const buffer = await renderToBuffer(
    element as unknown as React.ReactElement<DocumentProps>,
  );
  return buffer;
}

export default renderReportPdf;
