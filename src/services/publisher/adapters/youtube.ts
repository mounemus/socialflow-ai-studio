import type { PlatformAdapter } from '../types';
import { basicValidate, isMockMode, mockSuccess } from './_shared';

export const youtubeAdapter: PlatformAdapter = {
  platform: 'YOUTUBE',
  characterLimit: () => 5000,
  acceptedMediaTypes: () => ['video/mp4', 'video/quicktime'],
  validate: (input) => basicValidate(input, { maxChars: 5000, requireMedia: true }),
  async publish(input) {
    if (isMockMode()) return mockSuccess('youtube', input);
    // Real: Data API v3 videos.insert (resumable upload).
    return mockSuccess('youtube', input);
  },
};
