import type { PlatformAdapter } from '../types';
import { basicValidate, notImplemented } from './_shared';

/**
 * WhatsApp n'est pas une plateforme de publication dans SocialFlow — les
 * comptes WhatsApp servent uniquement à la boîte de réception (conversations
 * Zernio). Cet adaptateur existe seulement pour satisfaire l'exhaustivité de
 * `platformAdapters: Record<SocialPlatform, PlatformAdapter>` ; il n'est
 * jamais invoqué par le composer (WHATSAPP absent de FORMAT_OPTIONS).
 */
export const whatsappAdapter: PlatformAdapter = {
  platform: 'WHATSAPP',
  supportsRealPublishing: false,
  characterLimit: () => 4096,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 4096 }),
  async publish() {
    return notImplemented('WhatsApp');
  },
};
