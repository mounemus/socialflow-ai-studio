import type { PlatformAdapter } from '../types';
import { basicValidate, isRealMode, notImplemented, simulatedResult } from './_shared';

export const tiktokAdapter: PlatformAdapter = {
  platform: 'TIKTOK',
  supportsRealPublishing: false,
  characterLimit: () => 2200,
  acceptedMediaTypes: () => ['video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 2200, requireMedia: true }),
  async publish(input) {
    if (!isRealMode()) return simulatedResult('tiktok', input);
    // Content Posting API — nécessite l'approbation partenaire TikTok (4-8 semaines).
    return notImplemented('TikTok');
  },
};
