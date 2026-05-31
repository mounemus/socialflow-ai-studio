/**
 * Shared types for inbox platform adapters.
 *
 * Adapters export ingestComments() and ingestMentions() that return
 * RawInteraction[] — a platform-neutral shape that InboxIngestionService
 * persists as SocialInteraction rows.
 */
import type { SocialAccount } from '@prisma/client';

export type RawInteractionType = 'COMMENT' | 'DM' | 'MENTION' | 'REPLY' | 'REACTION';

export interface RawInteraction {
  externalId: string;
  type: RawInteractionType;
  threadId?: string;
  content: string;
  fromHandle: string;
  fromName?: string;
  fromAvatarUrl?: string;
  fromIsVerified?: boolean;
  postExternalId?: string;
  receivedAt: Date;
  rawData: Record<string, unknown>;
}

export interface IngestArgs {
  socialAccount: SocialAccount;
  token: string;
  since: Date;
}

export interface InboxAdapter {
  platform: 'INSTAGRAM' | 'FACEBOOK' | 'LINKEDIN';
  ingestComments(args: IngestArgs): Promise<RawInteraction[]>;
  ingestMentions(args: IngestArgs): Promise<RawInteraction[]>;
}
