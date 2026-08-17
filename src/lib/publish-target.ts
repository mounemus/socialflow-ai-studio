/**
 * Résolution UNIQUE de la destination d'un post — utilisée par /publish,
 * /schedule et par le pipeline (Acte 4 « Produire & publier ») pour afficher
 * la destination AVANT de publier. Avant, /publish et /schedule dupliquaient
 * la même logique et l'Acte 5 affichait « SIMULATION » en dur.
 *
 * Règle : compte de la marque du post d'abord, sinon n'importe quel compte
 * connecté de l'organisation sur cette plateforme, sinon partage MANUEL.
 */
import type { Post, SocialAccount } from '@prisma/client';
import { db } from '@/lib/db';
import { SOCIAL_PLATFORMS } from '@/lib/contracts';
import { resolvePostPlatform } from '@/lib/post-platform';
import { NotFoundError } from '@/lib/errors';

export type DestinationLink = 'zernio' | 'native' | 'manual';

export interface PublishTarget {
  platform: string | null;
  account: SocialAccount | null;
  mode: 'AUTO' | 'MANUAL';
}

export interface DestinationView {
  platform: string | null;
  mode: 'AUTO' | 'MANUAL';
  accountId: string | null;
  accountName: string | null;
  handle: string | null;
  /** Comment le compte publie : passerelle Zernio, jeton natif, ou aucun (manuel). */
  link: DestinationLink;
  /** true = ENABLE_REAL_PUBLISHING absent → la publication sera SIMULÉE. */
  simulated: boolean;
}

export function isRealPublishing(): boolean {
  return process.env.ENABLE_REAL_PUBLISHING === 'true';
}

export function linkOf(account: SocialAccount & { tokens?: unknown[] } | null): DestinationLink {
  if (!account) return 'manual';
  const meta = (account.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.lateAccountId === 'string' && meta.lateAccountId) return 'zernio';
  if (Array.isArray(account.tokens) && account.tokens.length > 0) return 'native';
  return 'manual';
}

/**
 * Résout le compte de publication d'un post. `socialAccountId` explicite gagne
 * (Studio → Diffusion) ; sinon `platform` du body, sinon la plateforme du post.
 */
export async function resolvePublishTarget(
  post: Post,
  organizationId: string,
  opts: { socialAccountId?: string | null; platform?: string | null } = {},
): Promise<PublishTarget> {
  if (opts.socialAccountId) {
    const account = await db.socialAccount.findFirst({
      where: { id: opts.socialAccountId, organizationId },
      include: { tokens: { select: { id: true } } },
    });
    if (!account) throw new NotFoundError('Social account not found in this organization');
    return { platform: account.platform, account, mode: 'AUTO' };
  }
  const platform =
    (opts.platform ? String(opts.platform).toUpperCase() : '') || (await resolvePostPlatform(post)) || null;
  if (!platform || !(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    return { platform, account: null, mode: 'MANUAL' };
  }
  const connectable = {
    organizationId,
    platform: platform as (typeof SOCIAL_PLATFORMS)[number],
    status: { in: ['CONNECTED', 'DEGRADED'] as ('CONNECTED' | 'DEGRADED')[] },
  };
  const account =
    (post.brandId
      ? await db.socialAccount.findFirst({
          where: { ...connectable, brandId: post.brandId },
          include: { tokens: { select: { id: true } } },
        })
      : null) ??
    (await db.socialAccount.findFirst({ where: connectable, include: { tokens: { select: { id: true } } } }));
  return { platform, account, mode: account ? 'AUTO' : 'MANUAL' };
}

export function describeDestination(target: PublishTarget): DestinationView {
  const a = target.account as (SocialAccount & { tokens?: unknown[] }) | null;
  return {
    platform: target.platform,
    mode: target.mode,
    accountId: a?.id ?? null,
    accountName: a?.displayName ?? a?.handle ?? null,
    handle: a?.handle ?? null,
    link: linkOf(a),
    simulated: !isRealPublishing(),
  };
}
