import type { SocialPlatform } from '@prisma/client';
import type { PlatformAdapter } from '../types';
import { facebookAdapter } from './facebook';
import { instagramAdapter } from './instagram';
import { linkedinAdapter } from './linkedin';
import { twitterAdapter } from './twitter';
import { tiktokAdapter } from './tiktok';
import { youtubeAdapter } from './youtube';
import { pinterestAdapter } from './pinterest';
import { whatsappAdapter } from './whatsapp';

/** Registre des adaptateurs plateformes — partagé entre le publisher et la gateway. */
export const platformAdapters: Record<SocialPlatform, PlatformAdapter> = {
  FACEBOOK: facebookAdapter,
  INSTAGRAM: instagramAdapter,
  LINKEDIN: linkedinAdapter,
  TWITTER: twitterAdapter,
  TIKTOK: tiktokAdapter,
  YOUTUBE: youtubeAdapter,
  PINTEREST: pinterestAdapter,
  // Pas de publication WhatsApp — conversation uniquement (cf. whatsapp.ts).
  WHATSAPP: whatsappAdapter,
};
