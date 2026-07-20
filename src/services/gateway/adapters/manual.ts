/**
 * ManualShareAdapter — dernier recours honnête : rien n'est envoyé,
 * l'utilisateur partage lui-même. Statut MANUAL_SHARE_REQUIRED, jamais
 * un succès déguisé.
 */
import type { SocialAccount, SocialPlatform } from '@prisma/client';
import type { PublishInput } from '@/services/publisher/types';
import type { GatewayContext, GatewayPublishResult, SocialGatewayAdapter } from '../types';

export const manualGatewayAdapter: SocialGatewayAdapter = {
  id: 'manual',
  isConfigured: () => true,
  supports(_platform: SocialPlatform, _account: SocialAccount) {
    return true;
  },
  async publish(_input: PublishInput, _ctx: GatewayContext): Promise<GatewayPublishResult> {
    return {
      success: false,
      simulated: false,
      mocked: false,
      error:
        'Aucune passerelle automatique disponible pour ce compte — partage manuel requis (contenu prêt dans la publication).',
      errorCode: 'NOT_IMPLEMENTED',
      gateway: 'manual',
    };
  },
};
