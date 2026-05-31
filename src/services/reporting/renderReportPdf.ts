/**
 * Re-export of the PDF renderer so callers can import it from the reporting
 * service root: `@/services/reporting/renderReportPdf`.
 *
 * The implementation lives in ./pdf/renderReportPdf.ts alongside the
 * @react-pdf/renderer Document component.
 */
export {
  renderReportPdf,
  renderReportPdf as default,
  type RenderReportPdfOptions,
  type ReportData,
  type WhiteLabel,
} from './pdf/renderReportPdf';
