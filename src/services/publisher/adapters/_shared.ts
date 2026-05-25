import type { PublishInput, PublishResult } from '../types';

export function isMockMode(): boolean {
  return process.env.ENABLE_REAL_PUBLISHING !== 'true';
}

export function mockSuccess(platform: string, input: PublishInput): PublishResult {
  const id = `mock_${platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    success: true,
    externalPostId: id,
    externalUrl: `https://example.com/${platform}/post/${id}`,
    mocked: true,
  };
}

export function basicValidate(
  input: PublishInput,
  opts: { maxChars: number; requireMedia?: boolean },
): { ok: boolean; reason?: string } {
  const len = (input.body ?? '').length + input.hashtags.join(' ').length;
  if (len > opts.maxChars) {
    return { ok: false, reason: `Body too long: ${len}/${opts.maxChars}` };
  }
  if (opts.requireMedia && input.mediaUrls.length === 0) {
    return { ok: false, reason: 'At least one media required' };
  }
  return { ok: true };
}
