/**
 * GmailInboxService — ingestion des boîtes Gmail connectées de l'organisation
 * (une connexion "organisation" + une par marque, cf. UserIntegration.brandId)
 * comme source de la boîte de réception Conversations.
 *
 *   - Une boîte par UserIntegration GMAIL active ; chacune est ingérée avec
 *     son propre token, et les interactions créées sont stampées avec le
 *     brandId de l'intégration (null pour la connexion "organisation").
 *   - Liste les mails récents (in:inbox, hors mails envoyés par nous, 3 derniers
 *     jours) via l'API Gmail REST (même pattern fetch direct que GoogleMailService).
 *   - Pré-filtre les ids déjà ingérés (externalId `gmail:{integrationId}:{id}` —
 *     préfixé par intégration pour éviter les collisions entre boîtes) avant
 *     tout GET détaillé, pour éviter des appels inutiles.
 *   - Un SocialInteraction par mail : platform EMAIL, type DM.
 *
 * Même contrat que ZernioInboxService: jamais de throw, dédoublonnage via
 * externalId @unique (P2002 = déjà ingéré), sentiment classifié à la création.
 */
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { GoogleMailService } from './GoogleMailService';
import { SentimentService } from '@/services/inbox/SentimentService';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

export interface GmailIngestResult {
  emails: number;
  skipped: number;
  reasons: Record<string, number>;
}

interface GmailMessageMeta {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

/** Parse un header `From: Nom <email>` — tolère l'absence de nom. */
function parseFrom(from: string): { name: string | null; email: string } {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return { name: name || null, email: m[2].trim() };
  }
  return { name: null, email: from.trim() };
}

function header(meta: GmailMessageMeta, name: string): string {
  return meta.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function mergeResults(a: GmailIngestResult, b: GmailIngestResult): GmailIngestResult {
  const reasons = { ...a.reasons };
  for (const [k, v] of Object.entries(b.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
  return { emails: a.emails + b.emails, skipped: a.skipped + b.skipped, reasons };
}

/** Ingère UNE boîte Gmail (une UserIntegration GMAIL) — org-wide (brandId null) ou dédiée à une marque. */
async function ingestForIntegration(
  organizationId: string,
  integrationId: string,
  brandId: string | null,
): Promise<GmailIngestResult> {
  const reasons: Record<string, number> = {};
  const bump = (r: string) => {
    reasons[r] = (reasons[r] ?? 0) + 1;
  };
  let emails = 0;
  let skipped = 0;
  const createdIds: string[] = [];
  const prefix = `gmail:${integrationId}:`;

  const token = await GoogleMailService.getAccessToken(organizationId, brandId);
  if (!token) {
    return { emails: 0, skipped: 0, reasons: { 'gmail-non-connecte': 1 } };
  }

  let ids: string[] = [];
  try {
    const listUrl = `${GMAIL_API}?${new URLSearchParams({
      q: 'in:inbox -from:me newer_than:3d',
      maxResults: '25',
    })}`;
    const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      logger.warn('GmailInboxService: liste des messages échouée', {
        organizationId,
        integrationId,
        status: res.status,
        error: json.error?.message,
      });
      return { emails: 0, skipped: 0, reasons: { 'liste-gmail-echouee': 1 } };
    }
    ids = (json.messages ?? []).map((m) => m.id);
  } catch (err) {
    logger.warn('GmailInboxService: appel liste Gmail échoué', { organizationId, integrationId, err: (err as Error).message });
    return { emails: 0, skipped: 0, reasons: { 'liste-gmail-exception': 1 } };
  }
  if (ids.length === 0) return { emails: 0, skipped: 0, reasons: {} };

  // Pré-filtre : ne récupère en détail que les ids pas déjà ingérés.
  const candidateExternalIds = ids.map((id) => `${prefix}${id}`);
  const existing = await db.socialInteraction.findMany({
    where: { externalId: { in: candidateExternalIds } },
    select: { externalId: true },
  });
  const existingSet = new Set(existing.map((e) => e.externalId));
  const newIds = ids.filter((id) => !existingSet.has(`${prefix}${id}`));

  for (const id of newIds) {
    try {
      const getParams = new URLSearchParams({ format: 'metadata' });
      getParams.append('metadataHeaders', 'From');
      getParams.append('metadataHeaders', 'Subject');
      getParams.append('metadataHeaders', 'Date');
      const getUrl = `${GMAIL_API}/${id}?${getParams}`;
      const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
      const meta = (await res.json().catch(() => ({}))) as GmailMessageMeta & { error?: { message?: string } };
      if (!res.ok) {
        skipped++;
        bump('get-message-echoue');
        continue;
      }

      const fromHeader = header(meta, 'From');
      const subject = header(meta, 'Subject') || '(sans objet)';
      const dateHeader = header(meta, 'Date');
      const { name: fromName, email: fromEmail } = parseFrom(fromHeader);
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();

      const created = await db.socialInteraction.create({
        data: {
          organizationId,
          brandId,
          externalId: `${prefix}${id}`,
          platform: 'EMAIL',
          type: 'DM',
          threadId: meta.threadId,
          content: `${subject} — ${meta.snippet ?? ''}`,
          fromHandle: fromEmail || 'inconnu',
          fromName,
          receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
          status: 'NEW',
          rawData: {
            gateway: 'gmail',
            gmailThreadId: meta.threadId,
            gmailMessageId: id,
            fromEmail,
            subject,
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      createdIds.push(created.id);
      emails++;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') continue; // déjà ingéré
      skipped++;
      bump('persist-email-echoue');
      logger.warn('GmailInboxService: persist email échoué', { id, err: (err as Error).message });
    }
  }

  // Sentiment, comme ZernioInboxService — best-effort.
  if (createdIds.length > 0) {
    try {
      const rows = await db.socialInteraction.findMany({
        where: { id: { in: createdIds } },
        select: { id: true, content: true },
      });
      const results = await SentimentService.classifyBatch(rows);
      await Promise.all(
        results.map((r) =>
          db.socialInteraction
            .update({
              where: { id: r.id },
              data: { sentiment: r.sentiment as never, sentimentScore: r.score ?? null },
            })
            .catch((err) =>
              logger.warn('GmailInboxService: mise à jour sentiment échouée', { id: r.id, err: (err as Error).message }),
            ),
        ),
      );
    } catch (err) {
      logger.warn('GmailInboxService: classification sentiment échouée', { err: (err as Error).message });
    }
  }

  logger.info('GmailInbox.summary', { organizationId, integrationId, brandId, emails, skipped, reasons });
  return { emails, skipped, reasons };
}

export const GmailInboxService = {
  /** Ingère TOUTES les boîtes Gmail actives de l'org (organisation + par marque). */
  async ingestForOrganization(organizationId: string): Promise<GmailIngestResult> {
    const integrations = await db.userIntegration.findMany({
      where: { organizationId, provider: 'GMAIL', active: true },
      select: { id: true, brandId: true },
    });
    if (integrations.length === 0) {
      return { emails: 0, skipped: 0, reasons: { 'gmail-non-connecte': 1 } };
    }
    let total: GmailIngestResult = { emails: 0, skipped: 0, reasons: {} };
    for (const integration of integrations) {
      const r = await ingestForIntegration(organizationId, integration.id, integration.brandId);
      total = mergeResults(total, r);
    }
    return total;
  },
};
