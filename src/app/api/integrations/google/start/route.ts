/**
 * GET /api/integrations/google/start — redirige vers le consentement Google
 * (connexion Gmail de l'organisation, ou d'une marque via ?brandId=, pour
 * l'envoi des campagnes email). State signé HMAC (pattern NéoBot) :
 * `orgId.brandId|_.nonce.signature` (`_` = pas de marque, connexion "organisation").
 */
import { NextResponse } from 'next/server';
import { randomBytes, createHmac } from 'node:crypto';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { GoogleMailService } from '@/services/integrations/GoogleMailService';

export const dynamic = 'force-dynamic';

function stateSecret(): string {
  return process.env.AUTH_SECRET ?? '';
}

export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    requirePermission(ctx.role, 'campaign.manage');
    if (!GoogleMailService.isConfigured()) {
      return NextResponse.redirect(
        new URL('/social-accounts?google=' + encodeURIComponent('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants'), req.url),
      );
    }
    const brandIdParam = new URL(req.url).searchParams.get('brandId');
    let brandPart = '_';
    if (brandIdParam) {
      const brand = await db.brand.findUnique({ where: { id: brandIdParam }, select: { organizationId: true } });
      if (brand?.organizationId === ctx.organizationId) brandPart = brandIdParam;
    }
    const nonce = randomBytes(8).toString('hex');
    const payload = `${ctx.organizationId}.${brandPart}.${nonce}`;
    const sig = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
    const url = GoogleMailService.buildAuthUrl(`${payload}.${sig}`);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = encodeURIComponent(((e as Error).message ?? 'oauth-failed').slice(0, 200));
    return NextResponse.redirect(new URL(`/social-accounts?google=${msg}`, req.url));
  }
}
