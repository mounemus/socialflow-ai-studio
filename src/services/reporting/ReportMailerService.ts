/**
 * ReportMailerService — envoi RÉEL des rapports programmés par email (Resend).
 *
 * Vérité opérationnelle : sans RESEND_API_KEY, l'envoi est déclaré SKIPPED
 * (raison explicite) — plus jamais de "would email to recipients" silencieux.
 */
import { logger } from '@/lib/logger';

const RESEND_API = 'https://api.resend.com/emails';

export interface MailResult {
  sent: boolean;
  skippedReason?: string;
  providerId?: string;
  error?: string;
}

export const ReportMailerService = {
  isConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
  },

  async sendReportEmail(args: {
    recipients: string[];
    reportTitle: string;
    reportId: string;
    brandName?: string | null;
    periodLabel?: string | null;
  }): Promise<MailResult> {
    if (args.recipients.length === 0) {
      return { sent: false, skippedReason: 'Aucun destinataire configuré.' };
    }
    if (!this.isConfigured()) {
      return {
        sent: false,
        skippedReason: 'RESEND_API_KEY non configurée — envoi email indisponible (statut honnête, pas de faux envoi).',
      };
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://socialflow-ai-studio.vercel.app';
    const from = process.env.REPORT_FROM_EMAIL ?? 'SocialFlow <onboarding@resend.dev>';
    const reportUrl = `${appUrl}/reports/${args.reportId}`;

    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: args.recipients,
          subject: `Rapport ${args.brandName ? `${args.brandName} — ` : ''}${args.reportTitle}`,
          html: [
            `<h2>${args.reportTitle}</h2>`,
            args.brandName ? `<p>Marque : <strong>${args.brandName}</strong></p>` : '',
            args.periodLabel ? `<p>Période : ${args.periodLabel}</p>` : '',
            `<p>Le rapport est prêt. <a href="${reportUrl}">Ouvrir le rapport</a> (PDF téléchargeable depuis la page).</p>`,
            `<p style="color:#64748b;font-size:12px">Envoyé automatiquement par SocialFlow AI Studio.</p>`,
          ].join('\n'),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        return { sent: false, error: `Resend ${res.status}: ${json.message ?? 'erreur inconnue'}` };
      }
      logger.info('Rapport envoyé par email', {
        reportId: args.reportId,
        recipients: args.recipients.length,
        providerId: json.id,
      });
      return { sent: true, providerId: json.id };
    } catch (err) {
      return { sent: false, error: (err as Error).message };
    }
  },
};
