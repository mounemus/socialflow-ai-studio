/**
 * GET /api/integrations/google/callback?code=…&state=… — retour du
 * consentement Google : vérifie le state HMAC, échange le code, stocke les
 * tokens chiffrés (UserIntegration GMAIL), puis retourne à la page Diffusion.
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { GoogleMailService } from '@/services/integrations/GoogleMailService';

export const dynamic = 'force-dynamic';

function verifyState(state: string | null): string | null {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [orgId, nonce, sig] = parts;
  const expected = createHmac('sha256', process.env.AUTH_SECRET ?? '')
    .update(`${orgId}.${nonce}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return orgId;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  const back = (q: string) => NextResponse.redirect(new URL(`/social-accounts?google=${q}`, req.url));

  if (err) return back(encodeURIComponent(err));
  if (!code) return back('missing-code');

  const organizationId = verifyState(state);
  if (!organizationId) return back('bad-state');

  try {
    const { email } = await GoogleMailService.exchangeCodeAndSave(organizationId, code);
    return back(`connected${email ? `:${encodeURIComponent(email)}` : ''}`);
  } catch (e) {
    return back(encodeURIComponent(((e as Error).message ?? 'oauth-failed').slice(0, 200)));
  }
}
