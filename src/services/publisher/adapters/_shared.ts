import { logger } from '@/lib/logger';
import type { PublishErrorCode, PublishInput, PublishResult } from '../types';

export function isRealMode(): boolean {
  return process.env.ENABLE_REAL_PUBLISHING === 'true';
}

/**
 * Simulation result — explicitly NOT a publication.
 * No external id, no URL: a simulated post must never be confused with a real one.
 */
export function simulatedResult(platform: string, input: PublishInput): PublishResult {
  logger.info('publish SIMULATED (no network call)', { platform, postId: input.postId });
  return { success: true, simulated: true, mocked: true };
}

export function publishFailure(error: string, errorCode: PublishErrorCode): PublishResult {
  return { success: false, simulated: false, mocked: false, error, errorCode };
}

/** Real mode requested but this adapter has no real API implementation yet. */
export function notImplemented(platform: string): PublishResult {
  return publishFailure(
    `Publication réelle non implémentée pour ${platform}. ` +
      `Désactivez ENABLE_REAL_PUBLISHING ou attendez l'intégration de cette plateforme.`,
    'NOT_IMPLEMENTED',
  );
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

export function composeMessage(input: PublishInput): string {
  const tags = input.hashtags.filter(Boolean).join(' ');
  return [input.body, tags].filter(Boolean).join('\n\n');
}

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** Minimal Meta Graph API helper. Throws with the Graph error message on failure. */
export async function graphFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; token: string; params?: Record<string, string> },
): Promise<T> {
  const params = new URLSearchParams({ ...(opts.params ?? {}), access_token: opts.token });
  const method = opts.method ?? 'GET';
  const url =
    method === 'GET' ? `${GRAPH_BASE}${path}?${params.toString()}` : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST' ? params : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!res.ok || json.error) {
    throw new Error(
      `Graph API ${res.status}: ${json.error?.message ?? 'unknown error'} (code ${json.error?.code ?? '?'})`,
    );
  }
  return json;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
