/**
 * InboxIngestionService — polls connected social accounts and creates
 * SocialInteraction rows for new comments / DMs / mentions.
 *
 * Architecture:
 *   ingestForOrg(orgId)
 *     → load SocialAccount[] with status CONNECTED
 *     → dispatch to per-platform adapter (ig/fb/linkedin)
 *     → Promise.allSettled across accounts so one bad token doesn't kill the run
 *     → persist via db.socialInteraction.create (externalId @unique → P2002 = skip)
 *     → match postExternalId to PostSchedule.externalPostId or Post.metadata
 *     → fire SentimentService.classifyBatch on newly persisted rows
 *     → bump SocialAccount.updatedAt for "last polled" tracking
 *
 * Adapters are required to NEVER throw — they catch and return [] on any
 * failure. This service adds a second try/catch layer for paranoia and to
 * surface the error in the returned `errors` array.
 */
import type { Prisma, SocialAccount, SocialPlatform } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/encryption';
import { SentimentService } from './SentimentService';
import { instagramInboxAdapter } from './adapters/instagram';
import { facebookInboxAdapter } from './adapters/facebook';
import { linkedinInboxAdapter } from './adapters/linkedin';
import type { RawInteraction } from './adapters/types';

interface AdapterShape {
  ingestComments(args: { socialAccount: SocialAccount; token: string; since: Date }): Promise<RawInteraction[]>;
  ingestMentions(args: { socialAccount: SocialAccount; token: string; since: Date }): Promise<RawInteraction[]>;
}

const ADAPTERS: Partial<Record<SocialPlatform, AdapterShape>> = {
  INSTAGRAM: instagramInboxAdapter,
  FACEBOOK: facebookInboxAdapter,
  LINKEDIN: linkedinInboxAdapter,
};

export interface IngestForOrgResult {
  ingested: number;
  byPlatform: Record<string, number>;
  errors: Array<{ platform: string; message: string }>;
}

export interface IngestForAllOrgsResult {
  totalIngested: number;
  perOrg: Array<{ orgId: string; count: number }>;
}

// Look back this far when SocialAccount.updatedAt is somehow null.
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const InboxIngestionService = {
  /**
   * Ingest new interactions for every connected social account in this org.
   * Returns counts + per-platform breakdown + structured errors. Never throws.
   */
  async ingestForOrg(organizationId: string): Promise<IngestForOrgResult> {
    const byPlatform: Record<string, number> = {};
    const errors: IngestForOrgResult['errors'] = [];
    let total = 0;

    let accounts: SocialAccount[] = [];
    try {
      accounts = await db.socialAccount.findMany({
        where: { organizationId, status: 'CONNECTED' },
      });
    } catch (err) {
      logger.error('InboxIngestionService load accounts failed', {
        organizationId,
        err: (err as Error).message,
      });
      return { ingested: 0, byPlatform, errors: [{ platform: 'all', message: (err as Error).message }] };
    }

    const settled = await Promise.allSettled(
      accounts.map((acc) => this.ingestForAccount(acc)),
    );

    for (let i = 0; i < settled.length; i += 1) {
      const acc = accounts[i];
      const res = settled[i];
      if (res.status === 'rejected') {
        errors.push({ platform: acc.platform, message: String(res.reason) });
        continue;
      }
      const { count, error } = res.value;
      byPlatform[acc.platform] = (byPlatform[acc.platform] ?? 0) + count;
      total += count;
      if (error) errors.push({ platform: acc.platform, message: error });
    }

    return { ingested: total, byPlatform, errors };
  },

  /**
   * Drive every org. Designed to be called by a cron route; safe to fan out.
   */
  async ingestForAllOrgs(): Promise<IngestForAllOrgsResult> {
    const perOrg: IngestForAllOrgsResult['perOrg'] = [];
    let total = 0;
    let orgs: Array<{ id: string }> = [];
    try {
      orgs = await db.organization.findMany({ select: { id: true } });
    } catch (err) {
      logger.error('InboxIngestionService.ingestForAllOrgs: load orgs failed', {
        err: (err as Error).message,
      });
      return { totalIngested: 0, perOrg: [] };
    }

    for (const o of orgs) {
      try {
        const r = await this.ingestForOrg(o.id);
        perOrg.push({ orgId: o.id, count: r.ingested });
        total += r.ingested;
      } catch (err) {
        logger.warn('InboxIngestionService.ingestForAllOrgs: org failed', {
          orgId: o.id,
          err: (err as Error).message,
        });
        perOrg.push({ orgId: o.id, count: 0 });
      }
    }

    return { totalIngested: total, perOrg };
  },

  /**
   * Internal helper — handle a single account. Returns { count, error? }.
   */
  async ingestForAccount(
    socialAccount: SocialAccount,
  ): Promise<{ count: number; error?: string }> {
    const adapter = ADAPTERS[socialAccount.platform];
    if (!adapter) {
      // Not implemented for this platform yet — silently skip.
      return { count: 0 };
    }

    // Decrypt the most recent token. If none / decrypt fails, skip (don't throw).
    let token = '';
    try {
      const tokenRow = await db.socialToken.findFirst({
        where: { socialAccountId: socialAccount.id },
        orderBy: { createdAt: 'desc' },
      });
      if (!tokenRow) {
        logger.warn('InboxIngestionService: no SocialToken for account', {
          accountId: socialAccount.id,
          platform: socialAccount.platform,
        });
        return { count: 0 };
      }
      token = decrypt(tokenRow.accessTokenEnc);
    } catch (err) {
      logger.warn('InboxIngestionService: token decrypt failed', {
        accountId: socialAccount.id,
        err: (err as Error).message,
      });
      return { count: 0, error: 'token_decrypt_failed' };
    }

    const since = socialAccount.updatedAt ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS);

    // Adapters never throw, but wrap anyway for paranoia.
    let raw: RawInteraction[] = [];
    try {
      const [comments, mentions] = await Promise.all([
        adapter.ingestComments({ socialAccount, token, since }),
        adapter.ingestMentions({ socialAccount, token, since }),
      ]);
      raw = [...comments, ...mentions];
    } catch (err) {
      logger.warn('InboxIngestionService: adapter threw (should not happen)', {
        accountId: socialAccount.id,
        err: (err as Error).message,
      });
      return { count: 0, error: 'adapter_threw' };
    }

    if (raw.length === 0) {
      await this.touchAccount(socialAccount.id);
      return { count: 0 };
    }

    const newlyCreated = await this.persistMany(socialAccount, raw);
    await this.touchAccount(socialAccount.id);

    // Sentiment pass — best-effort, never propagates failures.
    if (newlyCreated.length > 0) {
      try {
        const results = await SentimentService.classifyBatch(
          newlyCreated.map((r) => ({ id: r.id, content: r.content })),
        );
        await Promise.all(
          results.map((r) =>
            db.socialInteraction
              .update({
                where: { id: r.id },
                data: {
                  sentiment: r.sentiment as never,
                  sentimentScore: r.score ?? null,
                },
              })
              .catch((err) =>
                logger.warn('InboxIngestionService: sentiment update failed', {
                  id: r.id,
                  err: (err as Error).message,
                }),
              ),
          ),
        );
      } catch (err) {
        logger.warn('InboxIngestionService: sentiment batch failed', {
          err: (err as Error).message,
        });
      }
    }

    return { count: newlyCreated.length };
  },

  /**
   * Persist new RawInteraction[] for an account. Returns the rows that were
   * actually created (dedup-skipped rows are dropped).
   */
  async persistMany(
    socialAccount: SocialAccount,
    raw: RawInteraction[],
  ): Promise<Array<{ id: string; content: string }>> {
    const out: Array<{ id: string; content: string }> = [];
    for (const item of raw) {
      try {
        const postId = await this.resolvePostId(item.postExternalId, socialAccount.organizationId);
        const created = await db.socialInteraction.create({
          data: {
            organizationId: socialAccount.organizationId,
            brandId: socialAccount.brandId,
            socialAccountId: socialAccount.id,
            postId,
            externalId: item.externalId,
            platform: socialAccount.platform,
            type: item.type as never,
            threadId: item.threadId,
            content: item.content,
            fromHandle: item.fromHandle,
            fromName: item.fromName,
            fromAvatarUrl: item.fromAvatarUrl,
            fromIsVerified: item.fromIsVerified ?? false,
            receivedAt: item.receivedAt,
            rawData: item.rawData as Prisma.InputJsonValue,
          },
          select: { id: true, content: true },
        });
        out.push(created);
      } catch (err) {
        // P2002 = unique constraint on externalId — already ingested, skip silently.
        if ((err as { code?: string }).code === 'P2002') continue;
        logger.warn('InboxIngestionService: persist failed', {
          externalId: item.externalId,
          err: (err as Error).message,
        });
      }
    }
    return out;
  },

  /**
   * Try to map a platform post id back to one of our Post rows.
   * First match wins:
   *   1. PostSchedule.externalPostId — the canonical link
   *   2. Post.metadata->>externalPostId — fallback for legacy rows
   */
  async resolvePostId(
    postExternalId: string | undefined,
    organizationId: string,
  ): Promise<string | null> {
    if (!postExternalId) return null;
    try {
      const sched = await db.postSchedule.findFirst({
        where: { externalPostId: postExternalId, post: { organizationId } },
        select: { postId: true },
      });
      if (sched?.postId) return sched.postId;

      const post = await db.post.findFirst({
        where: {
          organizationId,
          metadata: { path: ['externalPostId'], equals: postExternalId },
        },
        select: { id: true },
      });
      return post?.id ?? null;
    } catch (err) {
      logger.warn('InboxIngestionService.resolvePostId failed', {
        postExternalId,
        err: (err as Error).message,
      });
      return null;
    }
  },

  /**
   * Bump SocialAccount.updatedAt as a poor-man's "lastPolledAt" so the next
   * cron tick uses it as `since` in the adapter.
   */
  async touchAccount(socialAccountId: string): Promise<void> {
    try {
      await db.socialAccount.update({
        where: { id: socialAccountId },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      logger.warn('InboxIngestionService.touchAccount failed', {
        socialAccountId,
        err: (err as Error).message,
      });
    }
  },
};
