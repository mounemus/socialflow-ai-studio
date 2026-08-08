import { db } from '@/lib/db';
import { platformFromFormat, PLATFORM_PREFIXES } from '@/lib/post-status';

const isPlatform = (v: string): boolean => (PLATFORM_PREFIXES as readonly string[]).includes(v);

/**
 * Plateforme cible d'un post, par ordre de fiabilité :
 *   1. déduite du `format` (INSTAGRAM_POST → INSTAGRAM) ;
 *   2. `metadata.platform` (écrite à la concrétisation) ;
 *   3. l'item de stratégie lié (`StrategyItem.platform`).
 *
 * L'étape 3 est indispensable : les formats transverses — AD_VISUAL,
 * EMAIL_MARKETING, CAMPAIGN_GUIDE… — n'encodent AUCUNE plateforme, alors que
 * l'item sait qu'il vise LinkedIn. Sans elle, publier/programmer ces posts
 * répondait « aucun compte social connecté » même avec les comptes rattachés.
 */
export async function resolvePostPlatform(post: {
  id: string;
  format?: string | null;
  metadata?: unknown;
}): Promise<string | null> {
  const fromFormat = platformFromFormat(post.format);
  if (fromFormat) return fromFormat;

  const meta = (post.metadata ?? null) as Record<string, unknown> | null;
  const fromMeta = typeof meta?.platform === 'string' ? meta.platform.toUpperCase() : null;
  if (fromMeta && isPlatform(fromMeta)) return fromMeta;

  const item = await db.strategyItem.findFirst({
    where: { postId: post.id },
    select: { platform: true },
  });
  const fromItem = (item?.platform ?? '').toUpperCase();
  return isPlatform(fromItem) ? fromItem : null;
}
