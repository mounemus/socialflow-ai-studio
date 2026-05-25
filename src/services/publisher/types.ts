import type { SocialPlatform } from '@prisma/client';

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

export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalUrl?: string;
  error?: string;
  mocked: boolean;
}

export interface PlatformAdapter {
  platform: SocialPlatform;
  validate(input: PublishInput): { ok: boolean; reason?: string };
  publish(input: PublishInput): Promise<PublishResult>;
  characterLimit(): number;
  acceptedMediaTypes(): string[];
}
