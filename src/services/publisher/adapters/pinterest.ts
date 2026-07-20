import type { PlatformAdapter } from '../types';
import { basicValidate, isRealMode, notImplemented, simulatedResult } from './_shared';

export const pinterestAdapter: PlatformAdapter = {
  platform: 'PINTEREST',
  supportsRealPublishing: false,
  characterLimit: () => 500,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 500, requireMedia: true }),
  async publish(input) {
    if (!isRealMode()) return simulatedResult('pinterest', input);
    // POST /v5/pins (scope pins:write) — pas encore intégré.
    return notImplemented('Pinterest');
  },
};
