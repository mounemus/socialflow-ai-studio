import type { PlatformAdapter } from '../types';
import { basicValidate, notImplemented } from './_shared';

/**
 * EMAIL n'est pas une plateforme de publication dans SocialFlow — utilisée
 * uniquement pour la boîte de réception Conversations (ingestion Gmail, cf.
 * GmailInboxService). Cet adaptateur existe seulement pour satisfaire
 * l'exhaustivité de `platformAdapters: Record<SocialPlatform, PlatformAdapter>` ;
 * il n'est jamais invoqué par le composer (EMAIL absent de FORMAT_OPTIONS).
 */
export const emailAdapter: PlatformAdapter = {
  platform: 'EMAIL',
  supportsRealPublishing: false,
  characterLimit: () => 10000,
  acceptedMediaTypes: () => [],
  validate: (input) => basicValidate(input, { maxChars: 10000 }),
  async publish() {
    return notImplemented('Email');
  },
};
