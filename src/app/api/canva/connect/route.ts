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
  if (!CanvaConnectService.isConfigured()) {
    return NextResponse.redirect(new URL('/admin/api-keys?error=canva_not_configured', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'));
  }

  const { verifier, challenge } = CanvaConnectService.generatePkce();
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('canva_pkce_verifier', verifier, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
  cookieStore.set('canva_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });

  const url = CanvaConnectService.buildAuthorizeUrl(state, challenge);
  return NextResponse.redirect(url);
});
