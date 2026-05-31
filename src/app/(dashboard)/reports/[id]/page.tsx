import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { ReportViewClient } from './ReportViewClient';
import type { ReportData, WhiteLabel } from '../_shared';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const report = await db.report.findFirst({
    where: { id, organizationId: membership.organizationId },
    include: { brand: { select: { id: true, name: true } } },
  });
  if (!report) notFound();

  return (
    <ReportViewClient
      report={{
        id: report.id,
        title: report.title,
        brandId: report.brandId,
        brandName: report.brand?.name ?? null,
        period: report.period,
        sections: report.sections,
        status: report.status,
        aiSummary: report.aiSummary,
        errorMessage: report.errorMessage,
        generatedAt: report.generatedAt ? report.generatedAt.toISOString() : null,
        data: (report.data ?? {}) as ReportData,
        whiteLabel: (report.whiteLabel ?? {}) as Partial<WhiteLabel>,
      }}
    />
  );
}
