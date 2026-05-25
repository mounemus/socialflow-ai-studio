import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const facebookAdapter: PlatformAdapter = {
  platform: 'FACEBOOK',
  characterLimit: () => 63206,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 63206 }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('facebook', input);
    // Real Graph API call would go here: POST /{page-id}/feed
    // Requires page access token with pages_manage_posts scope.
    return mockSuccess('facebook', input);
  },
};
