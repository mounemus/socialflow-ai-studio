import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { handle } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { CanvaConnectService } from '@/services/integrations/CanvaConnectService';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;

  if (error) {
    return NextResponse.redirect(`${appUrl}/admin/connections?canva_error=${encodeURIComponent(error)}`);
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('canva_oauth_state')?.value;
  const verifier = cookieStore.get('canva_pkce_verifier')?.value;

  if (!code || !state || !verifier || state !== expectedState) {
    return NextResponse.redirect(`${appUrl}/admin/connections?canva_error=invalid_state`);
  }

  try {
    const tokens = await CanvaConnectService.exchangeCodeForTokens(code, verifier);

    // Optionally fetch user info if profile:read was granted
    let displayName: string | undefined;
    let externalUserId: string | undefined;
    try {
      // We need to call the API directly here since we haven't saved yet
      const profileRes = await fetch('https://api.canva.com/rest/v1/users/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const data = (await profileRes.json()) as { user?: { id?: string; display_name?: string } };
        externalUserId = data.user?.id;
        displayName = data.user?.display_name;
      }
    } catch {
      // non-fatal
    }

    await CanvaConnectService.saveConnection({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      tokens,
      displayName,
      externalUserId,
    });

    cookieStore.delete('canva_pkce_verifier');
    cookieStore.delete('canva_oauth_state');

    await db.auditLog.create({
      data: { userId: ctx.userId, organizationId: ctx.organizationId, action: 'canva.connect', resource: 'integration' },
    });

    return NextResponse.redirect(`${appUrl}/admin/connections?canva_success=1`);
  } catch (err) {
    logger.error('Canva callback failed', { err: (err as Error).message });
    return NextResponse.redirect(`${appUrl}/admin/connections?canva_error=${encodeURIComponent((err as Error).message)}`);
  }
});
