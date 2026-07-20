import type { SocialAccount, SocialPage, SocialPlatform } from '@prisma/client';

export interface PublishInput {
  postId: string;
  scheduleId: string;
  socialAccountId: string;
  socialPageId?: string;
  body: string;
  hashtags: string[];
  mediaUrls: string[];
  cta?: string;
  linkUrl?: string;
  scheduledFor?: Date;
}

/**
 * Resolved at publish time by SocialPublisherService — adapters never read
 * tokens from the DB themselves.
 */
export interface PublishContext {
  account: SocialAccount;
  page?: SocialPage | null;
  /** Decrypted user/account access token (null when none stored or expired). */
  accessToken?: string | null;
}

export type PublishErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'NO_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'MISSING_TARGET'
  | 'UNSUPPORTED_MEDIA'
  | 'API_ERROR'
  | 'VALIDATION';

export interface PublishResult {
  /** True only when the platform accepted the post (real) OR simulation succeeded. Check `simulated` to tell them apart. */
  success: boolean;
  /** True when nothing was sent to the network. A simulated result is NEVER a publication. */
  simulated: boolean;
  /** Real platform post id — never synthesized. Absent on simulated/failed results. */
  externalPostId?: string;
  /** Real public URL — never synthesized. */
  externalUrl?: string;
  error?: string;
  errorCode?: PublishErrorCode;
  /** @deprecated alias of `simulated`, kept for older callers/UI. */
  mocked: boolean;
}

export interface PlatformAdapter {
  platform: SocialPlatform;
  /** Whether a real API call path exists in this adapter (vs. simulation-only). */
  supportsRealPublishing: boolean;
  validate(input: PublishInput): { ok: boolean; reason?: string };
  publish(input: PublishInput, ctx?: PublishContext): Promise<PublishResult>;
  characterLimit(): number;
  acceptedMediaTypes(): string[];
}
