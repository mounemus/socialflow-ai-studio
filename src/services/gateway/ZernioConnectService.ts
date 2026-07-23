/**
 * ZernioConnectService — configuration de la passerelle Zernio (ex-Late)
 * pilotée depuis SocialFlow, selon le quickstart officiel (docs.zernio.com) :
 *
 *   1. un Profile Zernio par organisation (multi-tenant propre) ;
 *   2. GET /connect/{platform}?profileId= → authUrl OAuth à ouvrir ;
 *   3. GET /accounts → comptes connectés, mappés automatiquement sur les
 *      SocialAccount locaux (metadata.lateAccountId), qui deviennent
 *      publiables via la LateGatewayAdapter.
 *
 * Le profileId est persisté dans UserIntegration (provider LATE) — la clé API
 * reste en env (LATE_API_KEY / ZERNIO_API_KEY), rien de secret en DB ici.
 */
import type { SocialPlatform } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ExternalApiError } from '@/lib/errors';

const PLATFORM_TO_ZERNIO: Record<SocialPlatform, string> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  LINKEDIN: 'linkedin',
  TWITTER: 'twitter',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  PINTEREST: 'pinterest',
};
const ZERNIO_TO_PLATFORM: Record<string, SocialPlatform> = Object.fromEntries(
  Object.entries(PLATFORM_TO_ZERNIO).map(([k, v]) => [v, k as SocialPlatform]),
);

function baseUrl(): string {
  return (process.env.LATE_API_BASE ?? 'https://zernio.com/api/v1').replace(/\/$/, '');
}
function apiKey(): string | undefined {
  return process.env.LATE_API_KEY ?? process.env.ZERNIO_API_KEY;
}

async function zernioFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = apiKey();
  if (!key) throw new ExternalApiError('late', 'LATE_API_KEY / ZERNIO_API_KEY manquante');
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) {
    // Zernio répond {"error": "..."} (pas {"message"}) — on remonte le vrai
    // motif, et on traduit le 402 (limite de forfait) en action concrète.
    const reason = json.message ?? json.error ?? 'erreur';
    const hint =
      res.status === 402
        ? ' — limite du forfait Zernio atteinte (profils/comptes) : vérifiez votre plan sur zernio.com'
        : '';
    throw new ExternalApiError('late', `Zernio ${res.status}: ${reason}${hint}`);
  }
  return json;
}

export const ZernioConnectService = {
  isConfigured(): boolean {
    return !!apiKey();
  },

  /** Profile Zernio de l'organisation — créé au premier besoin. */
  async ensureProfile(organizationId: string): Promise<string> {
    const existing = await db.userIntegration.findFirst({
      where: { organizationId, provider: 'LATE', active: true },
    });
    const existingProfileId = (existing?.externalUserId ?? '').trim();
    if (existingProfileId) return existingProfileId;

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    const wantedName = org?.name ?? `SocialFlow ${organizationId.slice(0, 8)}`;

    // RÉUTILISER avant de créer : les forfaits Zernio limitent le nombre de
    // profils — créer aveuglément renvoyait « Zernio 402 » dès qu'un profil
    // existait déjà (créé à la main ou lors d'une session précédente).
    let profileId: string | null = null;
    try {
      const listed = await zernioFetch<{
        profiles?: Array<{ _id: string; name?: string }>;
        data?: Array<{ _id: string; name?: string }>;
      }>(`/profiles`);
      const profiles = listed.profiles ?? listed.data ?? [];
      const match =
        profiles.find((p) => (p.name ?? '').toLowerCase() === wantedName.toLowerCase()) ??
        profiles[0];
      if (match?._id) {
        profileId = match._id;
        logger.info('Profil Zernio existant réutilisé', { organizationId, profileId });
      }
    } catch {
      // Liste indisponible — on tentera la création.
    }

    if (!profileId) {
      const created = await zernioFetch<{ profile: { _id: string } }>(`/profiles`, {
        method: 'POST',
        body: JSON.stringify({
          name: wantedName,
          description: 'Profil géré par SocialFlow AI Studio',
        }),
      });
      profileId = created.profile._id;
    }

    if (existing) {
      await db.userIntegration.update({
        where: { id: existing.id },
        data: { externalUserId: profileId, active: true },
      });
    } else {
      await db.userIntegration.create({
        data: {
          organizationId,
          provider: 'LATE',
          externalUserId: profileId,
          // Clé API en env — on stocke un marqueur, jamais la clé elle-même.
          accessTokenEnc: 'env:LATE_API_KEY',
          active: true,
          displayName: 'Zernio (Late)',
        },
      });
    }
    logger.info('Profil Zernio créé pour l’organisation', { organizationId, profileId });
    return profileId;
  },

  /** URL OAuth pour connecter un compte d'une plateforme au profil de l'org. */
  async getConnectUrl(organizationId: string, platform: SocialPlatform): Promise<string> {
    const profileId = await this.ensureProfile(organizationId);
    const zp = PLATFORM_TO_ZERNIO[platform];
    const res = await zernioFetch<{ authUrl?: string; url?: string }>(
      `/connect/${zp}?profileId=${encodeURIComponent(profileId)}`,
    );
    const authUrl = res.authUrl ?? res.url;
    if (!authUrl) throw new ExternalApiError('late', 'Zernio: pas d’authUrl dans la réponse');
    return authUrl;
  },

  /**
   * Synchronise les comptes Zernio → SocialAccount locaux.
   * - compte local existant (même plateforme + handle) → metadata.lateAccountId ;
   * - sinon création d'un SocialAccount CONNECTED publiable via Late.
   */
  async syncAccounts(organizationId: string): Promise<{
    mapped: number;
    created: number;
    total: number;
  }> {
    const res = await zernioFetch<{
      accounts: { _id: string; platform: string; username?: string; name?: string; profileId?: string }[];
    }>(`/accounts`);

    const profileId = await this.ensureProfile(organizationId);
    // Ne prendre que les comptes du profil de CETTE organisation (multi-tenant).
    const accounts = res.accounts.filter((a) => !a.profileId || a.profileId === profileId);

    let mapped = 0;
    let created = 0;
    for (const za of accounts) {
      const platform = ZERNIO_TO_PLATFORM[za.platform];
      if (!platform) continue;
      const handle = za.username ?? za.name ?? za._id;

      const existing = await db.socialAccount.findFirst({
        where: {
          organizationId,
          platform,
          OR: [
            { handle },
            { metadata: { path: ['lateAccountId'], equals: za._id } },
          ],
        },
      });

      if (existing) {
        const meta = (existing.metadata ?? {}) as Record<string, unknown>;
        await db.socialAccount.update({
          where: { id: existing.id },
          data: {
            metadata: { ...meta, lateAccountId: za._id } as never,
            status: 'CONNECTED',
          },
        });
        mapped++;
      } else {
        await db.socialAccount.create({
          data: {
            organizationId,
            platform,
            type: 'PROFILE',
            externalId: `late:${za._id}`,
            handle,
            displayName: za.name ?? handle,
            status: 'CONNECTED',
            metadata: { lateAccountId: za._id, source: 'zernio-sync' } as never,
          },
        });
        created++;
      }
    }
    logger.info('Sync des comptes Zernio terminé', { organizationId, mapped, created, total: accounts.length });
    return { mapped, created, total: accounts.length };
  },
};
