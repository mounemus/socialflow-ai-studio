/**
 * NativeGatewayAdapter — publication via les API officielles (Graph API,
 * LinkedIn), en réutilisant les adaptateurs plateformes existants.
 *
 * Ajout Phase 3 : VÉRIFICATION post-publication — l'identifiant externe
 * renvoyé par le réseau est RELU (GET) avant de déclarer PUBLISHED.
 * Échec de relecture → verified:false (le statut final devient ACTION_REQUIRED,
 * jamais un PUBLISHED non prouvé).
 */
import type { SocialAccount, SocialPlatform } from '@prisma/client';
import { logger } from '@/lib/logger';
import { platformAdapters } from '@/services/publisher/adapters';
import { isRealMode } from '@/services/publisher/adapters/_shared';
import type { PublishInput } from '@/services/publisher/types';
import type { GatewayContext, GatewayPublishResult, SocialGatewayAdapter } from '../types';

async function verifyExternalPost(
  platform: SocialPlatform,
  externalPostId: string,
  accessToken: string | null | undefined,
): Promise<boolean> {
  try {
    if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {
      if (!accessToken) return false;
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(externalPostId)}?fields=id&access_token=${encodeURIComponent(accessToken)}`,
      );
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return res.ok && json.id === externalPostId;
    }
    if (platform === 'LINKEDIN') {
      if (!accessToken) return false;
      const res = await fetch(
        `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(externalPostId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      // 200 = le post existe; 403 possible selon scopes → on considère vérifié
      // seulement sur 200 (403 = non prouvable, pas nécessairement absent).
      return res.ok;
    }
    return false;
  } catch (err) {
    logger.warn('Vérification post-publication échouée', {
      platform,
      externalPostId,
      err: (err as Error).message,
    });
    return false;
  }
}

export const nativeGatewayAdapter: SocialGatewayAdapter = {
  id: 'native',
  isConfigured: () => true, // la config réelle est par compte (tokens)
  supports(platform: SocialPlatform, _account: SocialAccount) {
    return platformAdapters[platform].supportsRealPublishing;
  },
  async publish(input: PublishInput, ctx: GatewayContext): Promise<GatewayPublishResult> {
    const adapter = platformAdapters[ctx.account.platform];
    const result = await adapter.publish(input, ctx);

    let verified: boolean | undefined;
    if (result.success && !result.simulated && result.externalPostId && isRealMode()) {
      verified = await verifyExternalPost(ctx.account.platform, result.externalPostId, ctx.accessToken);
    }
    return { ...result, gateway: 'native', verified };
  },
};
