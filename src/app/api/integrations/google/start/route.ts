/**
 * GET /api/integrations/google/start — redirige vers le consentement Google
 * (connexion Gmail de l'organisation pour l'envoi des campagnes email).
 * State signé HMAC (pattern NéoBot) : `orgId.nonce.signature`.
 */
import { NextResponse } from 'next/server';
import { randomBytes, createHmac } from 'node:crypto';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
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
    const nonce = randomBytes(8).toString('hex');
    const payload = `${ctx.organizationId}.${nonce}`;
    const sig = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
    const url = GoogleMailService.buildAuthUrl(`${payload}.${sig}`);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = encodeURIComponent(((e as Error).message ?? 'oauth-failed').slice(0, 200));
    return NextResponse.redirect(new URL(`/social-accounts?google=${msg}`, req.url));
  }
}
