import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const twitterAdapter: PlatformAdapter = {
  platform: 'TWITTER',
  characterLimit: () => 280,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4', 'image/gif'],
  validate: (input) => basicValidate(input, { maxChars: 280 }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('twitter', input);
    // Real: X API v2 POST /2/tweets. Tier limits apply (Free vs Basic vs Pro).
    return mockSuccess('twitter', input);
  },
};
