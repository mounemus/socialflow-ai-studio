/**
 * OutreachService — campagnes d'emailing (Resend, envoi réel) et de messagerie
 * sur les réseaux connectés (réponse aux conversations inbox existantes via
 * InboxReplyService — seul canal d'envoi DM honnête : pas de token = simulé,
 * pas de conversation = ignoré avec motif, jamais de faux « envoyé »).
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { InboxReplyService } from '@/services/inbox/InboxReplyService';
import { GoogleMailService, type MailAttachment } from '@/services/integrations/GoogleMailService';

const RESEND_API = 'https://api.resend.com/emails';
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

export interface SendReport {
  sent: number;
  simulated: number;
  failed: number;
  skipped: number;
  status: 'SENT' | 'PARTIAL' | 'FAILED';
}

export interface OutreachAttachment {
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** Récupère et encode en base64 les pièces jointes (une seule fois par campagne,
 * pas par destinataire) — plafonné à ~20 Mo au total, échec explicite sinon. */
async function loadAttachments(
  attachments: OutreachAttachment[] | undefined,
): Promise<{ ok: true; items: MailAttachment[] } | { ok: false; error: string }> {
  if (!attachments || attachments.length === 0) return { ok: true, items: [] };
  const items: MailAttachment[] = [];
  let totalBytes = 0;
  for (const a of attachments) {
    try {
      const res = await fetch(a.url);
      if (!res.ok) return { ok: false, error: `Pièce jointe "${a.name}" inaccessible (${res.status}).` };
      const buf = Buffer.from(await res.arrayBuffer());
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_ATTACHMENTS_BYTES) {
        return { ok: false, error: 'Pièces jointes trop volumineuses (max ~20 Mo au total).' };
      }
      items.push({
        filename: a.name,
        mimeType: a.mimeType || res.headers.get('content-type') || 'application/octet-stream',
        base64: buf.toString('base64'),
      });
    } catch (err) {
      return { ok: false, error: `Pièce jointe "${a.name}" : ${(err as Error).message}` };
    }
  }
  return { ok: true, items };
}

function personalize(text: string, name?: string | null, handle?: string | null): string {
  const who = (name ?? handle ?? '').trim();
  const replaced = text
    .replaceAll('{{nom}}', who)
    .replaceAll('{{name}}', who)
    // Champ de fusion des kits emailing (ex. campagne UbSkilled).
    .replaceAll('[Nom du destinataire]', who);
  if (who) return replaced;
  // Nom inconnu : aucun résidu d'échafaudage — « Bonjour , » devient « Bonjour, ».
  return replaced.replace(/[ \t]+([,.!?;:])/g, '$1');
}

/** Un corps qui est déjà un email HTML complet est envoyé tel quel. */
export function isHtmlBody(body: string): boolean {
  return /^\s*(<!doctype|<html|<head|<body|<table|<div)/i.test(body);
}

/** Gmail (connecté) → Resend → échec avec motif. Exporté pour réutilisation
 * hors campagnes (ex. alertes inbox) — même chemin d'envoi, pas de duplication. */
export async function sendOneEmail(args: {
  organizationId: string;
  to: string;
  subject: string;
  html: string;
  brandId?: string | null;
  /** Déjà résolues (base64) — voir loadAttachments, appelé une fois par campagne. */
  attachments?: MailAttachment[];
}): Promise<{ ok: boolean; via?: 'gmail' | 'resend'; error?: string }> {
  // 1. Gmail connecté (OAuth Google, pattern NéoBot) — envoi depuis la marque
  //    si connectée, sinon repli sur le compte "organisation". 2. Sinon Resend.
  //    3. Sinon échec avec motif exact.
  const gmail = await GoogleMailService.status(args.organizationId, args.brandId);
  if (gmail.connected) {
    const r = await GoogleMailService.sendEmail(args.organizationId, {
      to: args.to, subject: args.subject, html: args.html, brandId: args.brandId,
      attachments: args.attachments,
    });
    if (r.ok) return { ok: true, via: 'gmail' };
    // Token révoqué/expiré sans refresh : on retombe sur Resend si possible.
    if (!process.env.RESEND_API_KEY) return { ok: false, error: r.error };
    logger.warn('Envoi Gmail en échec — bascule Resend', { error: r.error });
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: 'Aucun canal email : connectez Gmail (bouton « Connecter Gmail ») ou configurez RESEND_API_KEY.',
    };
  }
  const from = process.env.REPORT_FROM_EMAIL ?? 'SocialFlow <onboarding@resend.dev>';
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [args.to], subject: args.subject, html: args.html,
        ...(args.attachments?.length
          ? { attachments: args.attachments.map((a) => ({ filename: a.filename, content: a.base64 })) }
          : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${json.message ?? 'erreur'}` };
    return { ok: true, via: 'resend' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Corps texte → HTML email minimal (paragraphes + sauts de ligne). */
function toHtml(body: string): string {
  const esc = body
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

export const OutreachService = {
  emailConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
  },

  /**
   * Envoie tous les destinataires PENDING d'une campagne. Chaque destinataire
   * est traité isolément — un échec n'arrête jamais le lot.
   */
  async sendCampaign(outreachId: string, userId: string): Promise<SendReport> {
    const outreach = await db.outreachCampaign.findUnique({
      where: { id: outreachId },
      include: { recipients: { where: { status: 'PENDING' } } },
    });
    if (!outreach) throw new Error('Campagne introuvable');

    await db.outreachCampaign.update({ where: { id: outreachId }, data: { status: 'SENDING' } });

    let sent = 0, simulated = 0, failed = 0, skipped = 0;

    // Récupérées une seule fois pour toute la campagne, pas par destinataire.
    const rawAttachments = outreach.channel === 'EMAIL' ? (outreach.attachments as unknown as OutreachAttachment[]) : [];
    const loaded = await loadAttachments(Array.isArray(rawAttachments) ? rawAttachments : []);
    const attachmentsError = loaded.ok ? null : loaded.error;
    const preparedAttachments = loaded.ok ? loaded.items : [];

    for (const r of outreach.recipients) {
      try {
        if (outreach.channel === 'EMAIL') {
          if (!r.email) {
            skipped++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: { status: 'SKIPPED', detail: 'Adresse email absente.' },
            });
            continue;
          }
          if (attachmentsError) {
            failed++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: { status: 'FAILED', detail: attachmentsError },
            });
            continue;
          }
          const personalized = personalize(outreach.body, r.name, r.handle);
          const result = await sendOneEmail({
            organizationId: outreach.organizationId,
            to: r.email,
            attachments: preparedAttachments,
            subject: personalize(outreach.subject ?? outreach.name, r.name, r.handle),
            html: isHtmlBody(outreach.body) ? personalized : toHtml(personalized),
            brandId: outreach.brandId,
          });
          if (result.ok) {
            sent++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: {
                status: 'SENT',
                sentAt: new Date(),
                detail: result.via === 'gmail' ? 'Envoyé via Gmail' : 'Envoyé via Resend',
              },
            });
          } else {
            failed++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: { status: 'FAILED', detail: result.error },
            });
          }
        } else {
          // SOCIAL_DM — uniquement en réponse à une conversation existante.
          if (!r.interactionId) {
            skipped++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: {
                status: 'SKIPPED',
                detail: 'Aucune conversation existante avec ce contact — envoi direct non pris en charge.',
              },
            });
            continue;
          }
          const result = await InboxReplyService.postReply(
            r.interactionId,
            personalize(outreach.body, r.name, r.handle),
            userId,
          );
          if (result.posted) {
            if (result.simulated) simulated++; else sent++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: {
                status: result.simulated ? 'SIMULATED' : 'SENT',
                sentAt: new Date(),
                detail: result.simulated ? 'Aucun jeton réel — envoi simulé.' : null,
              },
            });
          } else {
            failed++;
            await db.outreachRecipient.update({
              where: { id: r.id },
              data: { status: 'FAILED', detail: result.error ?? 'Échec inconnu' },
            });
          }
        }
      } catch (err) {
        failed++;
        await db.outreachRecipient.update({
          where: { id: r.id },
          data: { status: 'FAILED', detail: (err as Error).message },
        }).catch(() => {});
      }
    }

    const delivered = sent + simulated;
    const status: SendReport['status'] =
      delivered > 0 && failed === 0 ? 'SENT' : delivered > 0 ? 'PARTIAL' : 'FAILED';
    await db.outreachCampaign.update({
      where: { id: outreachId },
      data: { status, sentAt: new Date() },
    });
    logger.info('Campagne outreach envoyée', { outreachId, sent, simulated, failed, skipped });
    return { sent, simulated, failed, skipped, status };
  },
};
