import { handle } from '@/lib/api';
import { resolveReportContext } from '@/lib/tenant';
import { AppError } from '@/lib/errors';
import { renderReportPdf } from '@/services/reporting/pdf/renderReportPdf';
import type { ReportData, WhiteLabel } from '@/services/reporting/pdf/ReportDocument';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const { report } = await resolveReportContext(id);

  if (report.status !== 'READY') {
    throw new AppError('Report is not ready', 409, 'REPORT_NOT_READY');
  }

  const pdf = await renderReportPdf({
    data: report.data as unknown as ReportData,
    aiSummary: report.aiSummary ?? '',
    whiteLabel: report.whiteLabel as unknown as WhiteLabel,
  });

  const filename = `${(report.title || 'report').replace(/[^a-z0-9\-_]+/gi, '_')}.pdf`;

  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
