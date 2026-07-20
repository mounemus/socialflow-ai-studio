import type { PlatformAdapter } from '../types';
import {
  basicValidate,
  composeMessage,
  graphFetch,
  isRealMode,
  publishFailure,
  simulatedResult,
} from './_shared';

/**
 * Facebook Pages publishing via Graph API v21.
 * Requires: pages_manage_posts scope + a SocialPage (page) target.
 * Flow: user token → GET /{page-id}?fields=access_token → page token → POST feed/photos.
 */
export const facebookAdapter: PlatformAdapter = {
  platform: 'FACEBOOK',
  supportsRealPublishing: true,
  characterLimit: () => 63206,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 63206 }),
  async publish(input, ctx) {
    if (!isRealMode()) return simulatedResult('facebook', input);
    if (!ctx?.accessToken) {
      return publishFailure('Aucun jeton d’accès Facebook — reconnectez le compte.', 'NO_TOKEN');
    }
    const pageId = ctx.page?.externalId ?? input.socialPageId;
    if (!pageId) {
      return publishFailure(
        'Aucune Page Facebook sélectionnée — la publication sur un profil personnel n’est pas supportée par l’API.',
        'MISSING_TARGET',
      );
    }

    try {
      // Exchange the user token for the page access token.
      const page = await graphFetch<{ access_token?: string }>(`/${pageId}`, {
        token: ctx.accessToken,
        params: { fields: 'access_token' },
      });
      const pageToken = page.access_token;
      if (!pageToken) {
        return publishFailure(
          'Permission pages_manage_posts manquante (pas de page access token). Refaites la connexion avec les bons scopes.',
          'TOKEN_EXPIRED',
        );
      }

      const message = composeMessage(input);
      let postId: string;
      const image = input.mediaUrls.find((u) => !u.endsWith('.mp4'));
      if (image) {
        const r = await graphFetch<{ post_id?: string; id: string }>(`/${pageId}/photos`, {
          method: 'POST',
          token: pageToken,
          params: { url: image, caption: message },
        });
        postId = r.post_id ?? r.id;
      } else {
        const params: Record<string, string> = { message };
        if (input.linkUrl) params.link = input.linkUrl;
        const r = await graphFetch<{ id: string }>(`/${pageId}/feed`, {
          method: 'POST',
          token: pageToken,
          params,
        });
        postId = r.id;
      }

      return {
        success: true,
        simulated: false,
        mocked: false,
        externalPostId: postId,
        externalUrl: `https://www.facebook.com/${postId}`,
      };
    } catch (err) {
      return publishFailure(`Facebook: ${(err as Error).message}`, 'API_ERROR');
    }
  },
};
