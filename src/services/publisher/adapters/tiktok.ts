import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const tiktokAdapter: PlatformAdapter = {
  platform: 'TIKTOK',
  characterLimit: () => 2200,
  acceptedMediaTypes: () => ['video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 2200, requireMedia: true }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('tiktok', input);
    // Real: Content Posting API — requires business account & app review.
    return mockSuccess('tiktok', input);
  },
};
