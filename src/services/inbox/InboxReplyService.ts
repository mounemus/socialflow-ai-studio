/**
 * InboxReplyService — propose, post, and auto-orchestrate replies to social interactions.
 *
 *   - proposeReply: builds a brand-aware Claude prompt and returns a suggestion (never throws).
 *   - postReply:    dispatches the reply to the platform API (IG/FB/LinkedIn) and updates the interaction.
 *   - runAutoReplyForOrg: scans NEW interactions against the org's AutoReplyRule(s), proposes + posts/drafts.
 *
 * Defensive by design — every interaction is processed in isolation; one failure never kills the batch.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/encryption';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { BrandDNAService } from '@/services/intelligence/BrandDNAService';
import { replyLateComment, sendLateMessage } from '@/services/gateway/adapters/late';
import { GoogleMailService } from '@/services/integrations/GoogleMailService';
import type {
  InteractionSentiment,
  InteractionStatus,
  SocialPlatform,
} from '@prisma/client';

// =========================================================================
// Types
// =========================================================================

export interface ProposeReplyResult {
  suggestion: string;
  rationale: string;
  confidence: number;
}

export interface PostReplyResult {
  posted: boolean;
  /** True when nothing was actually sent to the platform (simulation mode). */
  simulated?: boolean;
  externalId?: string;
  error?: string;
}

export interface AutoReplyBatchResult {
  autoReplied: number;
  deferred: number;
  errors: number;
}

// =========================================================================
// Helpers
// =========================================================================

function sentimentLabel(s: InteractionSentiment | null | undefined): string {
  switch (s) {
    case 'POSITIVE':
      return 'positif';
    case 'NEGATIVE':
      return 'négatif';
    case 'NEUTRAL':
      return 'neutre';
    case 'SPAM':
      return 'spam';
    default:
      return 'inconnu';
  }
}

/**
 * Confidence heuristic anchored on sentiment certainty + score magnitude.
 * Positive sentiment = high confidence; spam/unknown = low.
 */
function confidenceFor(
  sentiment: InteractionSentiment | null | undefined,
  score: number | null | undefined,
): number {
  const base = (() => {
    switch (sentiment) {
      case 'POSITIVE':
        return 0.85;
      case 'NEUTRAL':
        return 0.6;
      case 'NEGATIVE':
        return 0.45;
      case 'SPAM':
        return 0.1;
      default:
        return 0.3;
    }
  })();
  if (typeof score === 'number') {
    return Math.max(0, Math.min(1, base * 0.6 + Math.abs(score) * 0.4));
  }
  return base;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function readRuleCounter(rawData: unknown): { date: string; count: number } {
  const raw = (rawData ?? {}) as Record<string, unknown>;
  const dc = raw.dailyCounter as { date?: string; count?: number } | undefined;
  return {
    date: typeof dc?.date === 'string' ? dc.date : '',
    count: typeof dc?.count === 'number' ? dc.count : 0,
  };
}

// =========================================================================
// Platform dispatch
// =========================================================================

interface DispatchInput {
  platform: SocialPlatform;
  accessToken: string;
  externalCommentId: string;
  postExternalId?: string | null;
  content: string;
}

interface DispatchResult {
  ok: boolean;
  simulated?: boolean;
  externalId?: string;
  error?: string;
}

async function dispatchPlatformReply(input: DispatchInput): Promise<DispatchResult> {
  const { platform, accessToken, externalCommentId, postExternalId, content } = input;

  // Simulation mode mirrors SocialPublisherService: nothing is sent to the
  // network and NO fake external id is fabricated.
  if (process.env.ENABLE_REAL_PUBLISHING !== 'true') {
    return { ok: true, simulated: true };
  }

  try {
    if (platform === 'INSTAGRAM') {
      const url = `https://graph.facebook.com/v17.0/${encodeURIComponent(externalCommentId)}/replies`;
      const body = new URLSearchParams({ message: content, access_token: accessToken });
      const res = await fetch(url, { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!res.ok) return { ok: false, error: json.error?.message ?? `IG ${res.status}` };
      return { ok: true, externalId: json.id };
    }

    if (platform === 'FACEBOOK') {
      const url = `https://graph.facebook.com/v17.0/${encodeURIComponent(externalCommentId)}/comments`;
      const body = new URLSearchParams({ message: content, access_token: accessToken });
      const res = await fetch(url, { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!res.ok) return { ok: false, error: json.error?.message ?? `FB ${res.status}` };
      return { ok: true, externalId: json.id };
    }

    if (platform === 'LINKEDIN') {
      // LinkedIn replies hang off the parent share/post URN, not the comment id.
      const parentUrn = postExternalId ?? externalCommentId;
      const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(parentUrn)}/comments`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-restli-protocol-version': '2.0.0',
        },
        body: JSON.stringify({
          actor: 'urn:li:person:me',
          object: parentUrn,
          message: { text: content },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        $URN?: string;
        message?: string;
      };
      if (!res.ok) return { ok: false, error: json.message ?? `LinkedIn ${res.status}` };
      return { ok: true, externalId: json.id ?? json.$URN };
    }

    return { ok: false, error: `Unsupported platform for reply: ${platform}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// =========================================================================
// Service
// =========================================================================

export const InboxReplyService = {
  /**
   * Build a brand-aware reply suggestion via AIRouterService (TEXT_SHORT_COPY, low temp).
   * Never throws — falls back to a neutral suggestion on failure.
   */
  async proposeReply(interactionId: string, promptFragment?: string): Promise<ProposeReplyResult> {
    try {
      const interaction = await db.socialInteraction.findUnique({
        where: { id: interactionId },
        include: {
          brand: true,
          post: true,
        },
      });

      if (!interaction) {
        return {
          suggestion: '',
          rationale: 'Interaction introuvable.',
          confidence: 0,
        };
      }

      const brandName = interaction.brand?.name ?? 'la marque';
      const brandId = interaction.brandId ?? null;

      let dnaFragment = '';
      if (brandId) {
        try {
          const dna = await BrandDNAService.getStoredFor(brandId);
          if (dna) {
            dnaFragment = BrandDNAService.buildPromptFragment(dna);
          }
        } catch (err) {
          logger.warn('InboxReplyService DNA load failed', {
            interactionId,
            err: (err as Error).message,
          });
        }
      }

      const postBody = interaction.post?.body ?? null;
      const sentiment = sentimentLabel(interaction.sentiment);

      const promptLines = [
        `Tu réponds à un commentaire social media en tant que la marque ${brandName}.`,
        dnaFragment || '',
        postBody ? `Le post original disait: ${postBody}` : '',
        promptFragment ? `CONSIGNES SPÉCIFIQUES:\n${promptFragment}` : '',
        `Le commentaire à traiter: '${interaction.content}' (sentiment: ${sentiment})`,
        `Réponds en 1-2 phrases, ton aligné avec la marque, sans emoji excessif, jamais désespéré.`,
      ].filter(Boolean);

      const prompt = promptLines.join('\n\n');

      const ai = await AIRouterService.generateTextForTask('TEXT_SHORT_COPY', {
        prompt,
        temperature: 0.4,
        maxTokens: 220,
        language: 'fr',
      });

      const suggestion = (ai.text ?? '').trim();
      const confidence = confidenceFor(interaction.sentiment, interaction.sentimentScore);
      const rationale = [
        `Sentiment détecté: ${sentiment}.`,
        dnaFragment ? 'BrandDNA appliqué.' : 'Pas de BrandDNA stocké — ton générique de marque.',
        promptFragment ? 'Consigne spécifique de la règle appliquée.' : '',
        postBody ? 'Contexte du post original inclus.' : 'Pas de post lié — réponse autonome.',
        ai.mocked ? 'Réponse mockée (provider IA indisponible).' : `Provider: ${ai.provider}.`,
      ]
        .filter(Boolean)
        .join(' ');

      return { suggestion, rationale, confidence };
    } catch (err) {
      logger.warn('InboxReplyService.proposeReply failed', {
        interactionId,
        err: (err as Error).message,
      });
      return {
        suggestion: '',
        rationale: `Échec proposition: ${(err as Error).message}`,
        confidence: 0,
      };
    }
  },

  /**
   * Dispatch the reply to the platform API and persist status.
   * Never throws — always returns a structured result.
   */
  async postReply(
    interactionId: string,
    content: string,
    userId: string,
  ): Promise<PostReplyResult> {
    try {
      const interaction = await db.socialInteraction.findUnique({
        where: { id: interactionId },
        include: {
          socialAccount: {
            include: {
              tokens: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      if (!interaction) return { posted: false, error: 'Interaction introuvable.' };

      // Chemin passerelle Zernio — comptes sans SocialToken natif, ingérés via
      // ZernioInboxService (rawData.gateway === 'late'). Répond via l'API Late
      // avant toute exigence de token natif.
      const gatewayRawData = (interaction.rawData ?? {}) as Record<string, unknown>;
      if (gatewayRawData.gateway === 'late') {
        const conversationId =
          typeof gatewayRawData.conversationId === 'string' ? gatewayRawData.conversationId : null;
        const latePostId = typeof gatewayRawData.latePostId === 'string' ? gatewayRawData.latePostId : null;
        const lateAccountId =
          typeof gatewayRawData.lateAccountId === 'string' ? gatewayRawData.lateAccountId : null;

        const dispatch = !lateAccountId
          ? { ok: false, error: 'accountId Zernio manquant sur cette interaction — resynchronise la boîte de réception.' }
          : interaction.type === 'DM' && conversationId
            ? await sendLateMessage(conversationId, content, lateAccountId)
            : latePostId
              ? await replyLateComment(latePostId, content, lateAccountId)
              : { ok: false, error: 'Référence Zernio manquante sur cette interaction (rawData).' };

        if (!dispatch.ok) {
          logger.warn('InboxReplyService.postReply gateway (Zernio) dispatch failed', {
            interactionId,
            type: interaction.type,
            error: dispatch.error,
          });
          return { posted: false, error: dispatch.error };
        }

        await db.socialInteraction.update({
          where: { id: interactionId },
          data: {
            status: 'REPLIED' as InteractionStatus,
            repliedAt: new Date(),
            repliedById: userId,
            replyContent: content,
          },
        });

        return { posted: true, simulated: false };
      }

      // Chemin Gmail — interactions ingérées par GmailInboxService
      // (rawData.gateway === 'gmail'). Répond par email au fromEmail, dans le
      // même fil Gmail (threadId), avant toute exigence de token natif.
      if (gatewayRawData.gateway === 'gmail') {
        const fromEmail = typeof gatewayRawData.fromEmail === 'string' ? gatewayRawData.fromEmail : null;
        const subject = typeof gatewayRawData.subject === 'string' ? gatewayRawData.subject : '';
        const gmailThreadId =
          typeof gatewayRawData.gmailThreadId === 'string' ? gatewayRawData.gmailThreadId : undefined;

        if (!fromEmail) {
          return { posted: false, error: 'Adresse email manquante sur cette interaction (rawData).' };
        }

        const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
        const sent = await GoogleMailService.sendEmail(interaction.organizationId, {
          to: fromEmail,
          subject: replySubject,
          html: content.replace(/\n/g, '<br>'),
          threadId: gmailThreadId,
        });

        if (!sent.ok) {
          logger.warn('InboxReplyService.postReply gateway (Gmail) dispatch failed', {
            interactionId,
            error: sent.error,
          });
          return { posted: false, error: sent.error };
        }

        await db.socialInteraction.update({
          where: { id: interactionId },
          data: {
            status: 'REPLIED' as InteractionStatus,
            repliedAt: new Date(),
            repliedById: userId,
            replyContent: content,
          },
        });

        return { posted: true, simulated: false };
      }

      if (!interaction.socialAccount) {
        return { posted: false, error: 'Compte social non lié à cette interaction.' };
      }

      const tokenRow = interaction.socialAccount.tokens[0];
      if (!tokenRow) {
        return { posted: false, error: 'Aucun token disponible pour ce compte social.' };
      }

      let accessToken: string;
      try {
        accessToken = decrypt(tokenRow.accessTokenEnc);
      } catch (err) {
        return { posted: false, error: `Token déchiffrement: ${(err as Error).message}` };
      }

      // postExternalId is stashed in rawData when available (LinkedIn requires the parent URN).
      const rawData = (interaction.rawData ?? {}) as Record<string, unknown>;
      const postExternalId =
        typeof rawData.postExternalId === 'string' ? rawData.postExternalId : null;

      const dispatch = await dispatchPlatformReply({
        platform: interaction.platform,
        accessToken,
        externalCommentId: interaction.externalId,
        postExternalId,
        content,
      });

      if (!dispatch.ok) {
        logger.warn('InboxReplyService.postReply dispatch failed', {
          interactionId,
          platform: interaction.platform,
          error: dispatch.error,
        });
        return { posted: false, error: dispatch.error };
      }

      await db.socialInteraction.update({
        where: { id: interactionId },
        data: {
          status: 'REPLIED' as InteractionStatus,
          repliedAt: new Date(),
          repliedById: userId,
          replyContent: content,
        },
      });

      return { posted: true, simulated: dispatch.simulated, externalId: dispatch.externalId };
    } catch (err) {
      logger.warn('InboxReplyService.postReply unexpected failure', {
        interactionId,
        err: (err as Error).message,
      });
      return { posted: false, error: (err as Error).message };
    }
  },

  /**
   * Auto-reply orchestrator for one org.
   * - Finds all NEW interactions covered by an enabled AutoReplyRule.
   * - Per rule, checks criteria (sentiment in allowed, score >= min, type in allowed, daily cap).
   * - Either posts immediately (requireApproval=false) or stores draft in replyContent (requireApproval=true).
   * - Defensive: each interaction handled in try/catch; one failure does not abort the batch.
   *
   * Daily counter strategy: we cap the BATCH (in-memory) at rule.dailyCap. The persistent
   * counter lives on the most recently auto-replied interaction's rawData.dailyCounter
   * keyed by ruleId — see incrementRuleCounter below. This avoids a schema migration.
   */
  async runAutoReplyForOrg(organizationId: string): Promise<AutoReplyBatchResult> {
    const out: AutoReplyBatchResult = { autoReplied: 0, deferred: 0, errors: 0 };

    let rules;
    try {
      rules = await db.autoReplyRule.findMany({
        where: { organizationId, enabled: true },
      });
    } catch (err) {
      logger.warn('InboxReplyService.runAutoReplyForOrg rules query failed', {
        organizationId,
        err: (err as Error).message,
      });
      return { ...out, errors: 1 };
    }

    if (rules.length === 0) return out;

    // Resolve a system user id for repliedById on auto-replies.
    let systemUserId: string | null = null;
    try {
      const owner = await db.teamMember.findFirst({
        where: { organizationId, role: 'OWNER' },
        select: { userId: true },
      });
      systemUserId = owner?.userId ?? null;
    } catch {
      systemUserId = null;
    }

    for (const rule of rules) {
      try {
        const interactions = await db.socialInteraction.findMany({
          where: {
            organizationId,
            status: 'NEW' as InteractionStatus,
            ...(rule.brandId ? { brandId: rule.brandId } : {}),
            ...(rule.allowedTypes.length > 0 ? { type: { in: rule.allowedTypes } } : {}),
            ...(rule.allowedSentiments.length > 0
              ? { sentiment: { in: rule.allowedSentiments } }
              : {}),
          },
          orderBy: { receivedAt: 'asc' },
          take: 100,
        });

        // Read persistent daily counter for THIS rule from the most recent counter-marker
        // interaction (rawData.dailyCounters[ruleId]). Best-effort; resets at midnight UTC.
        const today = todayUTC();
        let dailyCount = await loadDailyCount(organizationId, rule.id, today);

        for (const interaction of interactions) {
          try {
            if (dailyCount >= rule.dailyCap) {
              out.deferred += 1;
              continue;
            }

            // Sentiment-score gate (only when a score is recorded).
            if (
              typeof interaction.sentimentScore === 'number' &&
              interaction.sentimentScore < rule.minSentimentScore
            ) {
              out.deferred += 1;
              continue;
            }

            const proposal = await this.proposeReply(interaction.id, rule.customPromptFragment ?? undefined);
            if (!proposal.suggestion) {
              out.deferred += 1;
              continue;
            }
            if (proposal.suggestion.length > rule.maxReplyLength) {
              out.deferred += 1;
              continue;
            }

            if (rule.requireApproval) {
              // Pre-fill replyContent; status stays NEW for human approval.
              await db.socialInteraction.update({
                where: { id: interaction.id },
                data: { replyContent: proposal.suggestion },
              });
              out.deferred += 1;
              continue;
            }

            if (!systemUserId) {
              // No system user to attribute the reply to → degrade to draft.
              await db.socialInteraction.update({
                where: { id: interaction.id },
                data: { replyContent: proposal.suggestion },
              });
              out.deferred += 1;
              continue;
            }

            const posted = await this.postReply(
              interaction.id,
              proposal.suggestion,
              systemUserId,
            );
            if (posted.posted) {
              await db.socialInteraction.update({
                where: { id: interaction.id },
                data: {
                  isAutoReplied: true,
                  status: 'AUTO_REPLIED' as InteractionStatus,
                  rawData: mergeRawData(interaction.rawData, {
                    dailyCounters: {
                      [rule.id]: { date: today, count: dailyCount + 1 },
                    },
                  }) as never,
                },
              });
              out.autoReplied += 1;
              dailyCount += 1;
            } else {
              out.errors += 1;
            }
          } catch (err) {
            logger.warn('InboxReplyService auto-reply interaction failed', {
              interactionId: interaction.id,
              ruleId: rule.id,
              err: (err as Error).message,
            });
            out.errors += 1;
          }
        }
      } catch (err) {
        logger.warn('InboxReplyService rule iteration failed', {
          ruleId: rule.id,
          organizationId,
          err: (err as Error).message,
        });
        out.errors += 1;
      }
    }

    return out;
  },
};

// =========================================================================
// Internal — daily counter helpers
// =========================================================================

/**
 * Load today's auto-reply count for a rule by inspecting the most-recent
 * auto-replied interaction's rawData.dailyCounters[ruleId]. Resets if the
 * stored date is not today.
 */
async function loadDailyCount(
  organizationId: string,
  ruleId: string,
  today: string,
): Promise<number> {
  try {
    const marker = await db.socialInteraction.findFirst({
      where: {
        organizationId,
        isAutoReplied: true,
      },
      orderBy: { repliedAt: 'desc' },
      select: { rawData: true, repliedAt: true },
    });
    if (!marker) return 0;
    const raw = (marker.rawData ?? {}) as Record<string, unknown>;
    const dcs = raw.dailyCounters as Record<string, { date?: string; count?: number }> | undefined;
    const entry = dcs?.[ruleId];
    if (!entry || entry.date !== today) return 0;
    return typeof entry.count === 'number' ? entry.count : 0;
  } catch {
    return 0;
  }
}

function mergeRawData(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base = (existing ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      merged[k] = { ...(base[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

// expose for tests
export const __internal__ = { loadDailyCount, mergeRawData, readRuleCounter, confidenceFor };
