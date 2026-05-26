import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { handle } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { CanvaConnectService } from '@/services/integrations/CanvaConnectService';

/**
 * Start the Canva OAuth flow. Stores PKCE verifier in a short-lived secure cookie.
 */
export const GET = handle(async () => {
  await requireTenant(); // Auth required, but we don't need permission for connect itself.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  if (!CanvaConnectService.isConfigured()) {
    const reasons: string[] = [];
    if (!process.env.CANVA_CLIENT_ID) reasons.push('CANVA_CLIENT_ID');
    if (!process.env.CANVA_CLIENT_SECRET) reasons.push('CANVA_CLIENT_SECRET');
    if (process.env.ENABLE_CANVA_API !== 'true') reasons.push('ENABLE_CANVA_API=true');
    const msg = encodeURIComponent(`Env vars manquantes: ${reasons.join(', ')}`);
    return NextResponse.redirect(`${appUrl}/admin/setup/canva?error=${msg}`);
  }

  const { verifier, challenge } = CanvaConnectService.generatePkce();
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('canva_pkce_verifier', verifier, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
  cookieStore.set('canva_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });

  const url = CanvaConnectService.buildAuthorizeUrl(state, challenge);
  return NextResponse.redirect(url);
});
