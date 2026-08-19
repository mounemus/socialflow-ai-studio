import { z } from 'zod';
import sharp from 'sharp';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';
import { syncPostToStrategyItem } from '@/lib/post-item-sync';
import { normalizeLogoParams, logoPlacement } from '@/lib/logo-overlay';
import { prepareLogo } from '@/lib/logo-knockout';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  /** Visuel de base — par défaut le visuel sélectionné (coverMediaId) du post. */
  mediaId: z.string().optional(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).optional(),
  sizePct: z.number().optional(),
  opacity: z.number().optional(),
  marginPct: z.number().optional(),
});

/** Charge une image depuis une URL http(s) ou une data-URL base64. */
async function loadImage(src: string, label: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const m = src.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (!m) throw new ValidationError(`${label} : format data-URL non reconnu.`);
    return Buffer.from(m[1], 'base64');
  }
  const res = await fetch(src);
  if (!res.ok) throw new ValidationError(`${label} : téléchargement impossible (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Logo de la marque du post (buffer brut) — erreur explicite si absent. */
async function loadBrandLogo(post: { brandId: string | null }): Promise<Buffer> {
  if (!post.brandId) throw new ValidationError('Cette publication n’est liée à aucune marque.');
  const brand = await db.brand.findUnique({
    where: { id: post.brandId },
    select: { id: true, logo: true, name: true },
  });
  if (!brand?.logo) {
    throw new ValidationError(
      `La marque ${brand?.name ?? ''} n’a pas de logo — ajoute-le dans Configuration → Marques, puis réessaie.`,
    );
  }
  return loadImage(brand.logo, 'Logo de marque');
}

/**
 * GET /api/posts/[id]/brand-logo — le logo de marque tel qu'il sera incrusté
 * (détouré, transparent), pour l'aperçu temps réel côté client.
 */
export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const { post } = await resolvePostContext(id);
  const png = await prepareLogo(await loadBrandLogo(post), 400);
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' },
  });
});

/**
 * POST /api/posts/[id]/brand-logo — incruste le logo de la marque sur le
 * visuel choisi (position, taille, opacité, marge paramétrables), enregistre
 * le résultat comme NOUVEAU visuel (l'original est conservé) et le sélectionne
 * pour la publication.
 */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId, role, post } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  const body = schema.parse(await req.json().catch(() => ({})));
  const p = normalizeLogoParams(body);

  // Visuel de base : celui demandé, sinon le visuel sélectionné du post,
  // sinon le dernier attaché (même règle que la publication).
  const meta = (post.metadata as Record<string, unknown> | null) ?? {};
  const targetMediaId = body.mediaId ?? (typeof meta.coverMediaId === 'string' ? meta.coverMediaId : undefined);
  const asset = targetMediaId
    ? await db.mediaAsset.findFirst({ where: { id: targetMediaId, organizationId, kind: 'IMAGE' } })
    : await db.mediaAsset.findFirst({
        where: { organizationId, kind: 'IMAGE', posts: { some: { id } } },
        orderBy: { createdAt: 'desc' },
      });
  if (!asset?.url) throw new NotFoundError('Aucun visuel image à marquer sur cette publication.');

  const [baseBuf, logoBuf] = await Promise.all([loadImage(asset.url, 'Visuel'), loadBrandLogo(post)]);

  const base = sharp(baseBuf);
  const baseMeta = await base.metadata();
  const baseW = baseMeta.width ?? 0;
  const baseH = baseMeta.height ?? 0;
  if (!baseW || !baseH) throw new ValidationError('Dimensions du visuel illisibles.');

  const logoW = Math.max(16, Math.round((baseW * p.sizePct) / 100));
  let logo = await prepareLogo(logoBuf, logoW);
  if (p.opacity < 100) {
    // Réduction d'opacité : multiplication du canal alpha par un pixel
    // semi-transparent tuilé (blend dest-in) — recette sharp standard.
    logo = await sharp(logo)
      .composite([
        {
          input: Buffer.from([255, 255, 255, Math.round((255 * p.opacity) / 100)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();
  }
  const logoMeta = await sharp(logo).metadata();
  const { left, top } = logoPlacement(baseW, baseH, logoMeta.width ?? logoW, logoMeta.height ?? logoW, p);

  const outBuf = await base
    .composite([{ input: logo, left, top }])
    .png()
    .toBuffer();

  const uploaded = await SupabaseStorageService.uploadDataUrlDetailed({
    organizationId,
    dataUrl: `data:image/png;base64,${outBuf.toString('base64')}`,
    prefix: 'branded',
  });
  if (!uploaded.url) {
    throw new ValidationError(uploaded.error ?? 'Enregistrement du visuel marqué impossible.');
  }

  // Nouveau visuel attaché + sélectionné pour la publication — l'original
  // reste disponible dans la pellicule.
  const branded = await db.mediaAsset.create({
    data: {
      organizationId,
      brandId: post.brandId,
      kind: 'IMAGE',
      url: uploaded.url,
      source: 'branding',
      metadata: {
        via: 'brand-logo',
        baseMediaId: asset.id,
        params: p,
        producedAt: new Date().toISOString(),
      } as never,
      posts: { connect: { id } },
    },
  });
  await db.post.update({
    where: { id },
    data: {
      metadata: { ...meta, coverMediaId: branded.id, coverUrl: uploaded.url } as never,
    },
  });
  await syncPostToStrategyItem(id);

  return ok({ mediaId: branded.id, url: uploaded.url, params: p });
});
