import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const instagramAdapter: PlatformAdapter = {
  platform: 'INSTAGRAM',
  characterLimit: () => 2200,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 2200, requireMedia: true }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('instagram', input);
    // Real: two-step container + publish via Graph API. Business account required.
    return mockSuccess('instagram', input);
  },
};
