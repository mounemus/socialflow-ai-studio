import type { PlatformAdapter, PublishContext, PublishInput } from '../types';
import { basicValidate, composeMessage, isRealMode, publishFailure, simulatedResult } from './_shared';

const LINKEDIN_API = 'https://api.linkedin.com/v2';

async function linkedinFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(`${LINKEDIN_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LinkedIn API ${res.status}: ${text.slice(0, 300)}`);
  }
  return { data: (text ? JSON.parse(text) : {}) as T, headers: res.headers };
}

/** Upload one image to LinkedIn assets and return the asset URN. */
async function uploadImage(token: string, authorUrn: string, imageUrl: string): Promise<string> {
  const { data: reg } = await linkedinFetch<{
    value: {
      asset: string;
      uploadMechanism: Record<string, { uploadUrl: string }>;
    };
  }>(`/assets?action=registerUpload`, token, {
    method: 'POST',
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: authorUrn,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
        ],
      },
    }),
  });
  const mech = Object.values(reg.value.uploadMechanism)[0];
  const bin = await fetch(imageUrl);
  if (!bin.ok) throw new Error(`Téléchargement du média impossible (${bin.status})`);
  const buf = await bin.arrayBuffer();
  const up = await fetch(mech.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: buf,
  });
  if (!up.ok) throw new Error(`Upload LinkedIn échoué (${up.status})`);
  return reg.value.asset;
}

/**
 * LinkedIn publishing via UGC Posts API.
 * Person: scope w_member_social (author urn:li:person:{id}).
 * Organization page: scope w_organization_social (author urn:li:organization:{id}).
 */
export const linkedinAdapter: PlatformAdapter = {
  platform: 'LINKEDIN',
  supportsRealPublishing: true,
  characterLimit: () => 3000,
  acceptedMediaTypes: () => ['image/jpeg', 'image/png', 'video/mp4'],
  validate: (input) => basicValidate(input, { maxChars: 3000 }),
  async publish(input: PublishInput, ctx?: PublishContext) {
    if (!isRealMode()) return simulatedResult('linkedin', input);
    if (!ctx?.accessToken) {
      return publishFailure('Aucun jeton d’accès LinkedIn — reconnectez le compte.', 'NO_TOKEN');
    }

    const authorUrn = ctx.page?.externalId
      ? `urn:li:organization:${ctx.page.externalId}`
      : `urn:li:person:${ctx.account.externalId}`;
    const text = composeMessage(input);

    try {
      const image = input.mediaUrls.find((u) => !u.endsWith('.mp4'));
      let media: unknown[] | undefined;
      if (image) {
        const asset = await uploadImage(ctx.accessToken, authorUrn, image);
        media = [{ status: 'READY', media: asset }];
      }

      const body = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: media ? 'IMAGE' : input.linkUrl ? 'ARTICLE' : 'NONE',
            ...(media ? { media } : {}),
            ...(input.linkUrl && !media
              ? { media: [{ status: 'READY', originalUrl: input.linkUrl }] }
              : {}),
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };

      const { data, headers } = await linkedinFetch<{ id?: string }>(`/ugcPosts`, ctx.accessToken, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const postId = data.id ?? headers.get('x-restli-id') ?? undefined;
      if (!postId) {
        return publishFailure('LinkedIn: réponse sans identifiant de post.', 'API_ERROR');
      }
      return {
        success: true,
        simulated: false,
        mocked: false,
        externalPostId: postId,
        externalUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`,
      };
    } catch (err) {
      return publishFailure(`LinkedIn: ${(err as Error).message}`, 'API_ERROR');
    }
  },
};
