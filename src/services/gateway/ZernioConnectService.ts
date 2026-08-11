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
  WHATSAPP: 'whatsapp',
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
    } catch (err) {
      // Une clé invalide ou une base API erronée doit remonter telle quelle —
      // sinon on enchaîne sur un POST /profiles qui échoue en 402 « limite de
      // forfait », masquant la vraie cause (c'était le bug historique).
      logger.warn('Zernio GET /profiles en échec', { organizationId, error: (err as Error).message });
      throw err;
    }

    if (!profileId) {
      const created = await zernioFetch<{ profile?: { _id?: string }; _id?: string }>(`/profiles`, {
        method: 'POST',
        body: JSON.stringify({
          name: wantedName,
          description: 'Profil géré par SocialFlow AI Studio',
        }),
      });
      profileId = created.profile?._id ?? created._id ?? null;
      if (!profileId) {
        throw new ExternalApiError('late', 'Zernio: réponse de création de profil sans identifiant');
      }
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
  async syncAccounts(
    organizationId: string,
    // Marque à affecter d'office aux comptes rapatriés (choisie au moment de la
    // connexion). Appliquée aux comptes créés et aux comptes mappés encore
    // « sans marque » — jamais écrasée si un compte est déjà rattaché.
    defaultBrandId?: string | null,
  ): Promise<{
    mapped: number;
    created: number;
    total: number;
    /** Comptes ignorés (plateforme non gérée par SocialFlow, ex. linkedin_ads). */
    skipped: string[];
    /** Avertissements non bloquants (ex. plusieurs profils Zernio ambigus). */
    warnings: string[];
  }> {
    const warnings: string[] = [];
    // Sécurité multi-tenant : n'affecter que si la marque appartient à l'org.
    let brandId: string | null = null;
    if (defaultBrandId) {
      const brand = await db.brand.findFirst({
        where: { id: defaultBrandId, organizationId },
        select: { id: true },
      });
      brandId = brand?.id ?? null;
    }
    type ZAccount = {
      _id: string;
      platform: string;
      username?: string;
      name?: string;
      displayName?: string;
      // ⚠️ L'API renvoie profileId soit en chaîne, soit en OBJET
      // { _id, name, slug } (cf. OpenAPI Zernio). Comparer l'objet à une chaîne
      // éliminait TOUS les comptes → « 0 compte » alors que le dashboard en
      // affichait. On normalise systématiquement en identifiant.
      profileId?: string | { _id?: string; name?: string; slug?: string } | null;
    };
    const profileIdOf = (a: ZAccount): string | null => {
      const p = a.profileId;
      if (!p) return null;
      return typeof p === 'string' ? p : (p._id ?? null);
    };
    // Zernio renvoie tantôt { accounts }, tantôt { data } — on accepte les deux.
    const listAccounts = async (pid?: string): Promise<ZAccount[]> => {
      const res = await zernioFetch<{ accounts?: ZAccount[]; data?: ZAccount[] }>(
        pid ? `/accounts?profileId=${encodeURIComponent(pid)}` : `/accounts`,
      );
      return res.accounts ?? res.data ?? [];
    };

    let profileId = await this.ensureProfile(organizationId);
    let accounts = (await listAccounts(profileId)).filter((a) => {
      const pid = profileIdOf(a);
      return !pid || pid === profileId;
    });

    // AUTO-RÉPARATION : un profileId périmé (profil créé par une version
    // antérieure, ou comptes connectés sous le profil « Default » de Zernio)
    // faisait remonter 0 compte alors que le dashboard Zernio en affichait.
    // On repère alors le profil qui porte réellement les comptes et on le
    // ré-adopte pour cette organisation.
    if (accounts.length === 0) {
      const all = await listAccounts();
      if (all.length > 0) {
        const byProfile = new Map<string, ZAccount[]>();
        for (const a of all) {
          const key = profileIdOf(a) ?? '';
          byProfile.set(key, [...(byProfile.get(key) ?? []), a]);
        }
        // Un seul profil porteur → aucune ambiguïté multi-tenant.
        const candidates = [...byProfile.entries()].filter(([, list]) => list.length > 0);
        if (candidates.length === 1) {
          const [foundProfileId, list] = candidates[0];
          if (foundProfileId && foundProfileId !== profileId) {
            await db.userIntegration.updateMany({
              where: { organizationId, provider: 'LATE' },
              data: { externalUserId: foundProfileId },
            });
            logger.warn('Profil Zernio ré-adopté (profileId périmé)', {
              organizationId,
              ancien: profileId,
              nouveau: foundProfileId,
            });
            profileId = foundProfileId;
          }
          accounts = list;
        } else if (candidates.length > 1) {
          warnings.push(
            `${all.length} compte(s) trouvés répartis sur ${candidates.length} profils Zernio — impossible de choisir automatiquement. Vérifiez le profil dans Admin → Connexions.`,
          );
        }
      }
    }

    let mapped = 0;
    let created = 0;
    const skipped: string[] = [];
    for (const za of accounts) {
      const platform = ZERNIO_TO_PLATFORM[za.platform];
      if (!platform) {
        // Plateformes hors périmètre (linkedin_ads, threads…) : signalées, plus
        // jamais avalées en silence dans l'écart total vs mappés.
        skipped.push(`${za.platform} (${za.username ?? za.name ?? za._id})`);
        logger.info('Compte Zernio ignoré — plateforme non gérée', {
          organizationId,
          platform: za.platform,
        });
        continue;
      }
      const handle = za.username ?? za.displayName ?? za.name ?? za._id;

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
            // N'affecte la marque que si le compte n'en a pas déjà une.
            ...(brandId && !existing.brandId ? { brandId } : {}),
          },
        });
        mapped++;
      } else {
        await db.socialAccount.create({
          data: {
            organizationId,
            brandId: brandId ?? undefined,
            platform,
            type: 'PROFILE',
            externalId: `late:${za._id}`,
            handle,
            displayName: za.displayName ?? za.name ?? handle,
            status: 'CONNECTED',
            metadata: { lateAccountId: za._id, source: 'zernio-sync' } as never,
          },
        });
        created++;
      }
    }
    logger.info('Sync des comptes Zernio terminé', {
      organizationId, mapped, created, skipped: skipped.length, total: accounts.length,
    });
    return { mapped, created, total: accounts.length, skipped, warnings };
  },
};
