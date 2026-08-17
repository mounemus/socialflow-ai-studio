/**
 * ZernioInboxService — ingestion des commentaires/DM pour les comptes
 * publiés/connectés via la passerelle Zernio (ex-Late), qui n'ont pas de
 * SocialToken natif et sont donc ignorés par InboxIngestionService.
 *
 *   - Commentaires: un post par PublishAttempt(provider='late') récent avec
 *     un gatewayRef, dont le schedule est PUBLISHED → GET /inbox/comments.
 *   - DM: toutes les conversations Zernio accessibles par la clé API,
 *     rattachées au compte Zernio de la même plateforme (sinon le premier
 *     compte Zernio de l'org).
 *
 * Même contrat que InboxIngestionService: jamais de throw, dédoublonnage via
 * externalId @unique (P2002 = déjà ingéré), sentiment classifié à la création.
 */
import type { Prisma, SocialAccount } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { SentimentService } from './SentimentService';
import {
  listLateComments,
  listLateCommentedPosts,
  listLateConversations,
  listLateMentions,
  listLateMessages,
  lateAccountIdOf,
} from '@/services/gateway/adapters/late';

export interface ZernioIngestResult {
  comments: number;
  dms: number;
  mentions: number;
  skipped: number;
  reasons: Record<string, number>;
}

const MAX_PUBLISH_ATTEMPTS = 50;
/** Fenêtre de découverte des posts commentés (tous comptes, pas seulement publiés via SocialFlow). */
const COMMENTED_POSTS_WINDOW_DAYS = 90;

export const ZernioInboxService = {
  async ingestForOrganization(organizationId: string): Promise<ZernioIngestResult> {
    const reasons: Record<string, number> = {};
    const bump = (r: string) => {
      reasons[r] = (reasons[r] ?? 0) + 1;
    };
    let comments = 0;
    let dms = 0;
    let mentions = 0;
    let skipped = 0;
    const createdIds: string[] = [];

    // --- Comptes Zernio de l'org + profil (communs à tout ce qui suit) ----
    let lateAccounts: SocialAccount[] = [];
    try {
      const orgAccounts = await db.socialAccount.findMany({ where: { organizationId } });
      lateAccounts = orgAccounts.filter((acc) => !!lateAccountIdOf(acc));
    } catch (err) {
      logger.warn('ZernioInboxService: chargement comptes Zernio échoué', {
        organizationId,
        err: (err as Error).message,
      });
    }
    let profileId: string | undefined;
    try {
      const integ = await db.userIntegration.findFirst({
        where: { organizationId, provider: 'LATE', active: true },
        select: { externalUserId: true },
      });
      profileId = integ?.externalUserId ?? undefined;
    } catch {
      // best-effort — les appels fonctionnent aussi sans profileId
    }
    const byPlatform = new Map<string, SocialAccount>();
    for (const acc of lateAccounts) if (!byPlatform.has(acc.platform)) byPlatform.set(acc.platform, acc);
    // Rattachement fiable : l'accountId Zernio porté par la conversation/le post.
    const byLateId = new Map<string, SocialAccount>();
    for (const acc of lateAccounts) {
      const id = lateAccountIdOf(acc);
      if (id) byLateId.set(id, acc);
    }

    // --- Commentaires ------------------------------------------------------
    // Cibles = (a) TOUS les posts commentés des comptes connectés (GET
    // /inbox/comments — inclut les posts publiés hors SocialFlow), fusionnés
    // avec (b) les posts publiés via Zernio par SocialFlow (pour garder le
    // rattachement postId). Avant, seul (b) était lu → aucun commentaire sur
    // les publications faites directement sur les réseaux n'apparaissait.
    const targets = new Map<string, { lateAccId: string; account: SocialAccount; postId: string | null }>();

    let attempts: Array<{
      response: unknown;
      schedule: { postId: string; socialAccount: SocialAccount | null };
    }> = [];
    try {
      attempts = await db.publishAttempt.findMany({
        where: { organizationId, provider: 'late', schedule: { status: 'PUBLISHED' } },
        orderBy: { startedAt: 'desc' },
        take: MAX_PUBLISH_ATTEMPTS,
        select: {
          response: true,
          schedule: { select: { postId: true, socialAccount: true } },
        },
      });
    } catch (err) {
      logger.warn('ZernioInboxService: chargement publishAttempts échoué', {
        organizationId,
        err: (err as Error).message,
      });
    }
    for (const a of attempts) {
      const gatewayRef = (a.response as { gatewayRef?: string } | null)?.gatewayRef;
      const account = a.schedule.socialAccount;
      if (!gatewayRef || !account) {
        skipped++;
        bump(!gatewayRef ? 'pas-de-gateway-ref' : 'sans-compte');
        continue;
      }
      // accountId Zernio — EXIGÉ en query par /inbox/comments (constaté en prod).
      const lateAccId = lateAccountIdOf(account);
      if (!lateAccId) {
        skipped++;
        bump('compte-sans-late-id');
        continue;
      }
      targets.set(gatewayRef, { lateAccId, account, postId: a.schedule.postId });
    }

    if (lateAccounts.length > 0) {
      const since = new Date(Date.now() - COMMENTED_POSTS_WINDOW_DAYS * 86_400_000);
      for (const row of await listLateCommentedPosts({ profileId, since })) {
        if (row.isAd) {
          skipped++;
          bump('commentaire-pub-ignore');
          continue;
        }
        if (targets.has(row.latePostId)) continue;
        const account =
          byLateId.get(row.accountId)
          ?? (row.platform ? byPlatform.get(row.platform.toUpperCase()) : undefined);
        if (!account) {
          skipped++;
          bump('post-commente-compte-inconnu');
          continue;
        }
        targets.set(row.latePostId, { lateAccId: row.accountId, account, postId: null });
      }
    }

    for (const [latePostId, { lateAccId, account, postId }] of targets) {
      const items = await listLateComments(latePostId, lateAccId);
      for (const item of items) {
        if (!item.text) {
          skipped++;
          bump('commentaire-sans-texte');
          continue;
        }
        if (item.isOwner) {
          skipped++;
          bump('commentaire-du-compte-lui-meme');
          continue;
        }
        try {
          const created = await db.socialInteraction.create({
            data: {
              organizationId,
              brandId: account.brandId,
              socialAccountId: account.id,
              postId,
              externalId: `late:comment:${item.externalId}`,
              platform: account.platform,
              type: item.parentId ? 'REPLY' : 'COMMENT',
              content: item.text,
              fromHandle: item.authorId ?? item.authorName ?? 'inconnu',
              fromName: item.authorName,
              receivedAt: item.createdAt ? new Date(item.createdAt) : new Date(),
              status: 'NEW',
              threadId: item.parentId ?? undefined,
              rawData: { gateway: 'late', latePostId, lateAccountId: lateAccId, raw: item.raw } as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
          comments++;
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002') continue; // déjà ingéré
          skipped++;
          bump('persist-commentaire-echoue');
          logger.warn('ZernioInboxService: persist commentaire échoué', {
            externalId: item.externalId,
            err: (err as Error).message,
          });
        }
      }
    }

    // --- Mentions (LinkedIn organisations, via webhooks Zernio) ----------
    if (lateAccounts.length > 0) {
      for (const m of await listLateMentions(profileId)) {
        const account =
          (m.accountId ? byLateId.get(m.accountId) : undefined)
          ?? (m.platform ? byPlatform.get(m.platform.toUpperCase()) : undefined);
        if (!account) {
          skipped++;
          bump('mention-compte-inconnu');
          continue;
        }
        try {
          const created = await db.socialInteraction.create({
            data: {
              organizationId,
              brandId: account.brandId,
              socialAccountId: account.id,
              externalId: `late:mention:${m.id}`,
              platform: account.platform,
              type: 'MENTION',
              content: m.content,
              fromHandle: m.authorId ?? m.authorName ?? 'inconnu',
              fromName: m.authorName,
              receivedAt: m.publishedAt ? new Date(m.publishedAt) : new Date(),
              status: 'NEW',
              rawData: { gateway: 'late', permalink: m.permalink, raw: m.raw } as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
          mentions++;
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002') continue;
          skipped++;
          bump('persist-mention-echoue');
        }
      }
    }

    // --- DM: conversations, non rattachées à un post précis ---------------
    if (lateAccounts.length > 0) {
      const conversations = await listLateConversations(profileId);
      for (const conv of conversations) {
        const account =
          (conv.accountId ? byLateId.get(conv.accountId) : undefined)
          ?? (conv.platform ? byPlatform.get(conv.platform.toUpperCase()) : undefined)
          ?? lateAccounts[0];
        const lateAccId = conv.accountId ?? lateAccountIdOf(account);
        if (!lateAccId) {
          skipped++;
          bump('dm-sans-account-id');
          continue;
        }

        // La liste des conversations ne porte pas le texte (constaté en prod) :
        // on récupère les messages de chaque conversation et on ingère les
        // 10 derniers messages ENTRANTS (les sortants sont nos réponses).
        let messages = await listLateMessages(conv.conversationId, lateAccId);
        if (messages.length === 0 && conv.lastMessage?.text) {
          messages = [{
            id: conv.lastMessage.id,
            text: conv.lastMessage.text,
            from: conv.lastMessage.from,
            outbound: false,
            createdAt: conv.lastMessage.createdAt,
            raw: conv.raw,
          }];
        }
        const inbound = messages.filter((m) => !!m.text && !m.outbound).slice(-10);
        if (inbound.length === 0) {
          skipped++;
          bump(messages.length === 0 ? 'dm-sans-messages' : 'dm-que-sortants');
          continue;
        }

        for (const msg of inbound) {
          const text = msg.text as string;
          const msgKey = msg.id ?? hashText(text);
          try {
            const created = await db.socialInteraction.create({
              data: {
                organizationId,
                brandId: account.brandId,
                socialAccountId: account.id,
                externalId: `late:dm:${conv.conversationId}:${msgKey}`,
                platform: account.platform,
                type: 'DM',
                content: text,
                fromHandle: msg.from ?? conv.participantName ?? 'inconnu',
                fromName: conv.participantName,
                receivedAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
                status: 'NEW',
                threadId: conv.conversationId,
                rawData: {
                  gateway: 'late',
                  conversationId: conv.conversationId,
                  lateAccountId: lateAccId,
                  raw: msg.raw,
                } as Prisma.InputJsonValue,
              },
              select: { id: true },
            });
            createdIds.push(created.id);
            dms++;
          } catch (err) {
            if ((err as { code?: string }).code === 'P2002') continue; // déjà ingéré
            skipped++;
            bump('persist-dm-echoue');
            logger.warn('ZernioInboxService: persist DM échoué', {
              conversationId: conv.conversationId,
              err: (err as Error).message,
            });
          }
        }
      }
    }

    // --- Sentiment, comme InboxIngestionService — best-effort -------------
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
                logger.warn('ZernioInboxService: mise à jour sentiment échouée', {
                  id: r.id,
                  err: (err as Error).message,
                }),
              ),
          ),
        );
      } catch (err) {
        logger.warn('ZernioInboxService: classification sentiment échouée', { err: (err as Error).message });
      }
    }

    logger.info('ZernioInbox.summary', { organizationId, comments, dms, mentions, skipped, reasons });
    return { comments, dms, mentions, skipped, reasons };
  },
};

// ponytail: hash non-cryptographique — sert uniquement de clé de dédoublonnage
// stable quand Zernio ne fournit pas d'id de message; pas de garantie
// d'unicité absolue, upgrade vers un id fourni par l'API si disponible plus tard.
function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
