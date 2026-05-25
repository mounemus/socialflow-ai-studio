import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'LINKEDIN',
  characterLimit: () => 3000,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 3000 }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('linkedin', input);
    // Real: POST /ugcPosts with w_member_social or w_organization_social scope.
    return mockSuccess('linkedin', input);
  },
};
