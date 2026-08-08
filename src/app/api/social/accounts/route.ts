import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const createSchema = z.object({
  platform: z.enum(['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST']),
  type: z.enum(['PROFILE', 'PAGE', 'BUSINESS', 'CHANNEL', 'GROUP']).default('PROFILE'),
  // Optionnels côté client : déduits du handle si absents (enregistrement
  // manuel simplifié). En OAuth réel, le callback fournit les vraies valeurs.
  externalId: z.string().optional(),
  handle: z.string().min(1),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  brandId: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * Nettoie un handle saisi à la main : retire l'« @ », et si l'utilisateur colle
 * une URL de profil, en extrait le pseudo (dernier segment non vide). Évite les
 * « @@JobHunter » et « @https://facebook.com/123 » affichés tels quels.
 */
function normalizeHandle(raw: string): string {
  let h = raw.trim();
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      const seg = u.pathname.split('/').filter(Boolean);
      h = seg[seg.length - 1] || u.hostname;
    } catch {
      /* garde la valeur brute si l'URL est invalide */
    }
  }
  return h.replace(/^@+/, '').trim();
}

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const accounts = await db.socialAccount.findMany({
    where: { organizationId: ctx.organizationId },
    include: { brand: true, pages: true, _count: { select: { tokens: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(accounts);
});

/**
 * MOCK CONNECT. In MVP we let users register a social account manually (or via /api/social/connect OAuth start).
 * In real mode this endpoint is called BY the OAuth callback handler with a freshly received token.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'social.connect');
  const body = createSchema.parse(await req.json());

  const handle = normalizeHandle(body.handle);
  const displayName = body.displayName?.trim() || handle;
  // Enregistrement manuel : sans id plateforme réel, on en fabrique un stable
  // et déterministe (pas de doublon au ré-enregistrement du même handle).
  const externalId = body.externalId?.trim() || `manual:${body.platform}:${handle.toLowerCase()}`;

  const account = await db.socialAccount.upsert({
    where: { platform_externalId: { platform: body.platform, externalId } },
    update: {
      organizationId: ctx.organizationId,
      handle,
      displayName,
      avatarUrl: body.avatarUrl,
      brandId: body.brandId,
      permissions: body.permissions ?? [],
      status: 'CONNECTED',
    },
    create: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      platform: body.platform,
      type: body.type,
      externalId,
      handle,
      displayName,
      avatarUrl: body.avatarUrl,
      permissions: body.permissions ?? [],
      status: 'CONNECTED',
    },
  });
  return created(account);
});
