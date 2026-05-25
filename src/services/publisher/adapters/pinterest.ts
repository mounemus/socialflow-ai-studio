import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const pinterestAdapter: PlatformAdapter = {
  platform: 'PINTEREST',
  characterLimit: () => 500,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 500, requireMedia: true }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('pinterest', input);
    // Real: POST /v5/pins. Requires board ownership & scope pins:write.
    return mockSuccess('pinterest', input);
  },
};
