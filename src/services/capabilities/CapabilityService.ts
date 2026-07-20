/**
 * CapabilityService — the single source of truth for what the platform can
 * ACTUALLY do right now, per provider and per organization.
 *
 * Phase 0 rule: never show "prêt" or "succès" for a capability that is
 * simulated, unconfigured, or missing permissions. Every consumer (UI badges,
 * agent, publish flows) should read from here instead of guessing from env.
 */
import { db } from '@/lib/db';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { isRealMode } from '@/services/publisher/adapters/_shared';
import { CanvaConnectService } from '@/services/integrations/CanvaConnectService';
import type { SocialPlatform } from '@prisma/client';

export type CapabilityStatus =
  | 'VERIFIED'          // connecté et vérifié — appels réels possibles
  | 'CONNECTED_LIMITED' // connecté mais permissions/implémentation incomplètes
  | 'SIMULATED'         // disponible en simulation uniquement
  | 'ACTION_REQUIRED'   // configuré mais une action utilisateur/admin est nécessaire
  | 'NOT_CONFIGURED';   // aucune clé/connexion

export interface Capability {
  id: string;
  label: string;
  category: 'social' | 'design' | 'ai' | 'infra';
  status: CapabilityStatus;
  detail: string;
}

const SOCIAL_PLATFORMS: { platform: SocialPlatform; label: string }[] = [
  { platform: 'FACEBOOK', label: 'Facebook Pages' },
  { platform: 'INSTAGRAM', label: 'Instagram Business' },
  { platform: 'LINKEDIN', label: 'LinkedIn' },
  { platform: 'TWITTER', label: 'X (Twitter)' },
  { platform: 'TIKTOK', label: 'TikTok' },
  { platform: 'YOUTUBE', label: 'YouTube' },
  { platform: 'PINTEREST', label: 'Pinterest' },
];

export const CapabilityService = {
  async getForOrganization(organizationId: string): Promise<Capability[]> {
    const capabilities: Capability[] = [];

    // --- Social publishing, per platform ---
    const accounts = await db.socialAccount.findMany({
      where: { organizationId },
      include: { tokens: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    for (const { platform, label } of SOCIAL_PLATFORMS) {
      const adapter = SocialPublisherService.getAdapter(platform);
      const account = accounts.find((a) => a.platform === platform);
      const token = account?.tokens[0];
      const tokenValid = !!token && (!token.expiresAt || token.expiresAt > new Date());

      let status: CapabilityStatus;
      let detail: string;
      if (!isRealMode()) {
        status = 'SIMULATED';
        detail = 'ENABLE_REAL_PUBLISHING est désactivé — toute publication est simulée.';
      } else if (!adapter.supportsRealPublishing) {
        status = 'SIMULATED';
        detail = 'Publication réelle non implémentée pour cette plateforme.';
      } else if (!account) {
        status = 'NOT_CONFIGURED';
        detail = 'Aucun compte connecté pour cette organisation.';
      } else if (!tokenValid) {
        status = 'ACTION_REQUIRED';
        detail = token ? 'Jeton expiré — reconnectez le compte.' : 'Aucun jeton stocké — refaites la connexion OAuth.';
      } else {
        status = 'CONNECTED_LIMITED';
        detail = 'Compte connecté avec jeton valide. La vérification finale se fait à la première publication réelle (lecture de l’identifiant externe).';
      }
      capabilities.push({ id: `publish:${platform.toLowerCase()}`, label, category: 'social', status, detail });
    }

    // --- Canva ---
    let canvaStatus: CapabilityStatus;
    let canvaDetail: string;
    if (!CanvaConnectService.isConfigured()) {
      canvaStatus = 'NOT_CONFIGURED';
      canvaDetail = 'CANVA_CLIENT_ID / CANVA_CLIENT_SECRET absents ou ENABLE_CANVA_API désactivé. Mode handoff/manuel uniquement.';
    } else {
      const token = await CanvaConnectService.getValidAccessToken(organizationId).catch(() => null);
      if (!token) {
        canvaStatus = 'ACTION_REQUIRED';
        canvaDetail = 'API configurée mais aucune connexion OAuth active — cliquez « Connect Canva ».';
      } else {
        canvaStatus = 'CONNECTED_LIMITED';
        canvaDetail =
          'Connexion active (lecture designs/exports). La création automatique depuis un Brand Template nécessite les scopes enterprise + brand_template_id — mode HANDOFF utilisé.';
      }
    }
    capabilities.push({ id: 'canva', label: 'Canva Connect', category: 'design', status: canvaStatus, detail: canvaDetail });

    // --- AI providers (env-based) ---
    const realAI = process.env.ENABLE_REAL_AI === 'true';
    const aiProviders: { id: string; label: string; configured: boolean }[] = [
      { id: 'ai:anthropic', label: 'Anthropic Claude', configured: !!process.env.ANTHROPIC_API_KEY },
      { id: 'ai:openai', label: 'OpenAI', configured: !!process.env.OPENAI_API_KEY },
      { id: 'ai:gemini', label: 'Google Gemini', configured: !!process.env.GOOGLE_GEMINI_API_KEY },
      { id: 'ai:stability', label: 'Stability AI', configured: !!process.env.STABILITY_API_KEY },
      { id: 'ai:replicate', label: 'Replicate', configured: !!process.env.REPLICATE_API_TOKEN },
    ];
    for (const p of aiProviders) {
      capabilities.push({
        id: p.id,
        label: p.label,
        category: 'ai',
        status: !p.configured ? 'NOT_CONFIGURED' : realAI ? 'VERIFIED' : 'SIMULATED',
        detail: !p.configured
          ? 'Clé API absente.'
          : realAI
            ? 'Clé présente et IA réelle activée.'
            : 'Clé présente mais ENABLE_REAL_AI désactivé — réponses mock.',
      });
    }

    // --- Infra ---
    const hasRedis = !!process.env.REDIS_URL && process.env.REDIS_URL !== 'mock';
    capabilities.push({
      id: 'infra:queue',
      label: 'File de publication (Redis/BullMQ)',
      category: 'infra',
      status: hasRedis ? 'VERIFIED' : 'SIMULATED',
      detail: hasRedis ? 'Queue asynchrone active.' : 'Pas de Redis — publications exécutées en synchrone.',
    });

    return capabilities;
  },
};
