import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { InboxIngestionService } from '@/services/inbox/InboxIngestionService';
import { InboxReplyService } from '@/services/inbox/InboxReplyService';
import { ZernioInboxService } from '@/services/inbox/ZernioInboxService';
import { GmailInboxService } from '@/services/integrations/GmailInboxService';
import { sendOneEmail } from '@/services/outreach/OutreachService';

// Anti-spam : pas plus d'une alerte inbox par org dans cette fenêtre.
const INBOX_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Alerte email « nouveaux messages » pour une org — best-effort, ne throw
 * jamais (une org en échec ne doit pas casser la boucle du cron).
 * Anti-spam et destinataire stockés/résolus sans nouveau modèle :
 *   - cooldown : Organization.settings (Json existant) → inboxAlertLastSentAt
 *   - destinataire : TeamMember role=OWNER de l'org (même résolution que
 *     InboxReplyService.runAutoReplyForOrg pour le "system user").
 */
async function sendInboxAlertEmail(organizationId: string, comments: number, dms: number): Promise<void> {
  const total = comments + dms;
  if (total <= 0) return;
  try {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) return;
    const settings = (org.settings ?? {}) as Record<string, unknown>;
    const lastSentAt =
      typeof settings.inboxAlertLastSentAt === 'string' ? new Date(settings.inboxAlertLastSentAt).getTime() : 0;
    if (Date.now() - lastSentAt < INBOX_ALERT_COOLDOWN_MS) return;

    const owner = await db.teamMember.findFirst({
      where: { organizationId, role: 'OWNER' },
      select: { user: { select: { email: true } } },
    });
    const to = owner?.user.email;
    if (!to) {
      logger.warn('Inbox alert: pas de propriétaire avec email pour cette org', { organizationId });
      return;
    }

    // ponytail: aperçus approximés par les interactions NEW les plus récentes
    // de l'org (ZernioInboxService ne renvoie pas les ids qu'il vient de
    // créer) — suffisant pour un résumé ; upgrade si le service renvoie un
    // jour ces ids directement.
    const previews = await db.socialInteraction.findMany({
      where: { organizationId, status: 'NEW' },
      orderBy: { receivedAt: 'desc' },
      take: 5,
      select: { fromName: true, content: true, platform: true },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://socialflow-ai-studio.vercel.app';
    const plural = total > 1 ? 's' : '';
    const html = [
      `<h2>${total} nouveau${total > 1 ? 'x' : ''} message${plural} sur vos réseaux</h2>`,
      '<ul>',
      ...previews.map(
        (p) =>
          `<li><strong>${escHtml(p.fromName ?? 'Inconnu')}</strong> (${escHtml(p.platform)}) — ${escHtml(
            (p.content ?? '').slice(0, 80),
          )}</li>`,
      ),
      '</ul>',
      `<p><a href="${appUrl}/conversations">Ouvrir les conversations</a></p>`,
      `<p style="color:#64748b;font-size:12px">Envoyé automatiquement par SocialFlow AI Studio.</p>`,
    ].join('\n');

    const mail = await sendOneEmail({
      organizationId,
      to,
      subject: `${total} nouveau${total > 1 ? 'x' : ''} message${plural} sur vos réseaux`,
      html,
    });
    if (mail.ok) {
      await db.organization.update({
        where: { id: organizationId },
        data: { settings: { ...settings, inboxAlertLastSentAt: new Date().toISOString() } as Prisma.InputJsonValue },
      });
    } else {
      logger.warn('Inbox alert: aucun canal email disponible — envoi ignoré', {
        organizationId,
        error: mail.error,
      });
    }
  } catch (err) {
    logger.error('Inbox alert email failed', { organizationId, err: (err as Error).message });
  }
}

/**
 * Vercel Cron — every 5 minutes.
 *   1. Sweep all orgs for new social interactions (comments/DMs/mentions).
 *   2. For each org with at least one enabled AutoReplyRule, run auto-reply.
 *
 * Secured by CRON_SECRET (Vercel sends Authorization: Bearer $CRON_SECRET).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (secret && header !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const ingestion = await InboxIngestionService.ingestForAllOrgs();

    // Ingestion passerelle Zernio/Late — comptes sans SocialToken natif,
    // indépendante d'ENABLE_REAL_PUBLISHING (le post est réellement publié).
    // Marqueur fiable d'une org Zernio : un SocialAccount créé par la
    // passerelle (externalId 'late:...') — la ligne UserIntegration n'existe
    // pas pour les connexions faites avant son introduction.
    const lateOrgs = await db.socialAccount.findMany({
      where: { externalId: { startsWith: 'late:' } },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    const zernioResults = [];
    for (const { organizationId } of lateOrgs) {
      try {
        const r = await ZernioInboxService.ingestForOrganization(organizationId);
        zernioResults.push({ organizationId, ...r });
        await sendInboxAlertEmail(organizationId, r.comments + r.mentions, r.dms);
      } catch (err) {
        logger.error('Zernio inbox ingestion failed for org', {
          organizationId,
          err: (err as Error).message,
        });
      }
    }

    // Ingestion Gmail — boîte de l'organisation connectée via UserIntegration
    // GMAIL, indépendante de Zernio (peut coexister avec des comptes sociaux).
    const gmailOrgs = await db.userIntegration.findMany({
      where: { provider: 'GMAIL', active: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    const gmailResults = [];
    for (const { organizationId } of gmailOrgs) {
      try {
        const r = await GmailInboxService.ingestForOrganization(organizationId);
        gmailResults.push({ organizationId, ...r });
        await sendInboxAlertEmail(organizationId, 0, r.emails);
      } catch (err) {
        logger.error('Gmail inbox ingestion failed for org', {
          organizationId,
          err: (err as Error).message,
        });
      }
    }

    // Run auto-reply only for orgs that actually have enabled rules — avoids
    // touching every org on every tick.
    const orgIdsWithEnabledRules = await db.autoReplyRule.findMany({
      where: { enabled: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    const autoReplyResults = [];
    for (const { organizationId } of orgIdsWithEnabledRules) {
      try {
        autoReplyResults.push(await InboxReplyService.runAutoReplyForOrg(organizationId));
      } catch (err) {
        logger.error('Inbox auto-reply failed for org', {
          organizationId,
          err: (err as Error).message,
        });
      }
    }

    const summary = {
      ingestion,
      zernio: {
        orgs: lateOrgs.length,
        totalComments: zernioResults.reduce((s, r) => s + r.comments, 0),
        totalDms: zernioResults.reduce((s, r) => s + r.dms, 0),
        results: zernioResults,
      },
      gmail: {
        orgs: gmailOrgs.length,
        totalEmails: gmailResults.reduce((s, r) => s + r.emails, 0),
        results: gmailResults,
      },
      autoReply: {
        orgs: orgIdsWithEnabledRules.length,
        totalReplied: autoReplyResults.reduce((s, r) => s + r.autoReplied, 0),
        totalDeferred: autoReplyResults.reduce((s, r) => s + r.deferred, 0),
        totalErrors: autoReplyResults.reduce((s, r) => s + r.errors, 0),
        results: autoReplyResults,
      },
    };
    logger.info('Inbox sync cron complete', summary);
    return NextResponse.json(summary);
  } catch (err) {
    logger.error('Inbox sync cron failed', { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
