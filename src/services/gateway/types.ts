import type { SocialAccount, SocialPage, SocialPlatform } from '@prisma/client';
import type { PublishInput, PublishResult } from '@/services/publisher/types';

/**
 * Passerelles de publication. L'UI et les services métier ne parlent JAMAIS
 * directement à un fournisseur externe — uniquement à SocialGatewayService,
 * qui route vers l'un de ces adaptateurs.
 */
export type GatewayId = 'native' | 'late' | 'manual';

export interface GatewayContext {
  account: SocialAccount;
  page?: SocialPage | null;
  /** Token natif déchiffré (adaptateur native uniquement). */
  accessToken?: string | null;
}

export interface GatewayPublishResult extends PublishResult {
  gateway: GatewayId;
  /** Identifiant côté passerelle (ex: _id du post Late) — distinct de l'id réseau. */
  gatewayRef?: string;
  /** True quand l'identifiant externe a été relu avec succès sur le réseau. */
  verified?: boolean;
}

export interface PublicationStatus {
  status: 'QUEUED' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'UNKNOWN';
  externalPostId?: string;
  externalUrl?: string;
  raw?: unknown;
}

export interface SocialGatewayAdapter {
  id: GatewayId;
  /** Configuration globale présente (clés env...). */
  isConfigured(): boolean;
  /** La passerelle peut-elle publier sur cette plateforme pour CE compte ? */
  supports(platform: SocialPlatform, account: SocialAccount): boolean;
  publish(input: PublishInput, ctx: GatewayContext): Promise<GatewayPublishResult>;
  /** Relecture du statut côté passerelle (polling / après webhook). */
  getPublicationStatus?(gatewayRef: string): Promise<PublicationStatus>;
}
