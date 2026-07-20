import type { PlatformAdapter } from '../types';
import { basicValidate, isRealMode, notImplemented, simulatedResult } from './_shared';

export const youtubeAdapter: PlatformAdapter = {
  platform: 'YOUTUBE',
  supportsRealPublishing: false,
  characterLimit: () => 5000,
  acceptedMediaTypes: () => ['video/mp4', 'video/quicktime'],
  validate: (input) => basicValidate(input, { maxChars: 5000, requireMedia: true }),
  async publish(input) {
    if (!isRealMode()) return simulatedResult('youtube', input);
    // Data API v3 videos.insert (upload résumable) — pas encore intégré.
    return notImplemented('YouTube');
  },
};
