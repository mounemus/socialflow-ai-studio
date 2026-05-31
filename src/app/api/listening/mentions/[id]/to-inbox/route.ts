import { handle, ok, created } from '@/lib/api';
import { resolveMentionContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import type { InteractionSentiment, MentionSentiment } from '@prisma/client';

// MentionSentiment carries an extra MIXED value the inbox doesn't model; collapse
// it (and any unknown) onto the closest InteractionSentiment.
const SENTIMENT_MAP: Record<MentionSentiment, InteractionSentiment> = {
  POSITIVE: 'POSITIVE',
  NEGATIVE: 'NEGATIVE',
  NEUTRAL: 'NEUTRAL',
  MIXED: 'NEUTRAL',
  UNKNOWN: 'UNKNOWN',
};

/**
 * POST /api/listening/mentions/[id]/to-inbox
 * Push a brand mention into the unified inbox by creating a SocialInteraction
 * MENTION row that links back to the mention. Idempotent: if the mention has
 * already been pushed, returns the existing interaction.
 *
 * Org is derived from the mention (mention → org) — multi-tenant safe.
 * Returns the created (or existing) interaction id.
 */

// Listening sources that map 1:1 onto a SocialPlatform. Web / News / Blog /
// Forum have no social-account equivalent; we fall back to TWITTER for inbox
// display while preserving the true source in rawData.
const PLATFORM_MAP: Record<string, string> = {
  TWITTER: 'TWITTER',
  INSTAGRAM: 'INSTAGRAM',
  FACEBOOK: 'FACEBOOK',
  LINKEDIN: 'LINKEDIN',
  YOUTUBE: 'YOUTUBE',
};

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const { organizationId, mention } = await resolveMentionContext(id);

  const platform = PLATFORM_MAP[String(mention.source).toUpperCase()] ?? 'TWITTER';
  // Deterministic externalId doubles as the idempotency key: a second push of
  // the same mention resolves to the same inbox interaction.
  const externalId = `mention:${mention.id}`;

  const existing = await db.socialInteraction.findUnique({
    where: { externalId },
    select: { id: true },
  });
  if (existing) {
    return ok({ interactionId: existing.id, alreadyLinked: true });
  }

  // Upsert protects against a duplicate externalId if a previous request raced.
  const interaction = await db.socialInteraction.upsert({
    where: { externalId },
    create: {
      organizationId,
      brandId: mention.brandId,
      externalId,
      platform: platform as never,
      type: 'MENTION' as never,
      content: mention.content,
      fromHandle: mention.authorHandle ?? mention.authorName ?? 'unknown',
      fromName: mention.authorName ?? null,
      sentiment: SENTIMENT_MAP[mention.sentiment],
      status: 'NEW' as never,
      receivedAt: mention.publishedAt ?? mention.ingestedAt,
      rawData: {
        origin: 'listening',
        mentionId: mention.id,
        source: mention.source,
        url: mention.url ?? null,
      },
    },
    update: {},
    select: { id: true },
  });

  // Mark the mention responded/handled now that it's in the inbox.
  await db.brandMention.update({
    where: { id: mention.id },
    data: { status: 'RESPONDED' as never },
  });

  return created({ interactionId: interaction.id });
});
