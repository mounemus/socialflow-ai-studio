import type { PlatformAdapter } from '../types';
import {
  basicValidate,
  composeMessage,
  graphFetch,
  isRealMode,
  publishFailure,
  simulatedResult,
  sleep,
} from './_shared';

/**
 * Instagram Business publishing via the Content Publishing API.
 * Requires: instagram_content_publish scope + an IG Business/Creator account
 * (SocialAccount.externalId = IG user id).
 * Flow: POST /{ig-user}/media (container) → poll status_code → POST media_publish.
 */
export const instagramAdapter: PlatformAdapter = {
  platform: 'INSTAGRAM',
  supportsRealPublishing: true,
  characterLimit: () => 2200,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 2200, requireMedia: true }),
  async publish(input, ctx) {
    if (!isRealMode()) return simulatedResult('instagram', input);
    if (!ctx?.accessToken) {
      return publishFailure('Aucun jeton d’accès Instagram — reconnectez le compte.', 'NO_TOKEN');
    }
    const igUserId = ctx.account.externalId;
    if (!igUserId) {
      return publishFailure('Compte Instagram Business introuvable (externalId manquant).', 'MISSING_TARGET');
    }

    const caption = composeMessage(input);
    const media = input.mediaUrls[0];
    const isVideo = media.endsWith('.mp4') || media.includes('video');

    try {
      const containerParams: Record<string, string> = isVideo
        ? { media_type: 'REELS', video_url: media, caption }
        : { image_url: media, caption };
      const container = await graphFetch<{ id: string }>(`/${igUserId}/media`, {
        method: 'POST',
        token: ctx.accessToken,
        params: containerParams,
      });

      // Containers are processed async — poll with backoff (videos take longer).
      const maxAttempts = isVideo ? 12 : 6;
      let status = 'IN_PROGRESS';
      for (let i = 0; i < maxAttempts && status !== 'FINISHED'; i++) {
        await sleep(Math.min(2000 * (i + 1), 10_000));
        const check = await graphFetch<{ status_code: string }>(`/${container.id}`, {
          token: ctx.accessToken,
          params: { fields: 'status_code' },
        });
        status = check.status_code;
        if (status === 'ERROR') {
          return publishFailure('Instagram: le traitement du média a échoué (container ERROR).', 'API_ERROR');
        }
      }
      if (status !== 'FINISHED') {
        return publishFailure('Instagram: délai de traitement du média dépassé — réessayez.', 'API_ERROR');
      }

      const published = await graphFetch<{ id: string }>(`/${igUserId}/media_publish`, {
        method: 'POST',
        token: ctx.accessToken,
        params: { creation_id: container.id },
      });

      let externalUrl: string | undefined;
      try {
        const perma = await graphFetch<{ permalink?: string }>(`/${published.id}`, {
          token: ctx.accessToken,
          params: { fields: 'permalink' },
        });
        externalUrl = perma.permalink;
      } catch {
        // permalink is best-effort — the post id alone is proof of publication
      }

      return {
        success: true,
        simulated: false,
        mocked: false,
        externalPostId: published.id,
        externalUrl,
      };
    } catch (err) {
      return publishFailure(`Instagram: ${(err as Error).message}`, 'API_ERROR');
    }
  },
};
