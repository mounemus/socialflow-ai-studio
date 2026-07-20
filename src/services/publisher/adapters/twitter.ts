import type { PlatformAdapter } from '../types';
import { basicValidate, isRealMode, notImplemented, simulatedResult } from './_shared';

export const twitterAdapter: PlatformAdapter = {
  platform: 'TWITTER',
  supportsRealPublishing: false,
  characterLimit: () => 280,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4', 'image/gif'],
  validate: (input) => basicValidate(input, { maxChars: 280 }),
  async publish(input) {
    if (!isRealMode()) return simulatedResult('twitter', input);
    // X API v2 POST /2/tweets — pas encore intégré (tier Basic payant requis).
    return notImplemented('X (Twitter)');
  },
};
