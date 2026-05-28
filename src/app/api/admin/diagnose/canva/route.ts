import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';

/**
 * Diagnose Canva OAuth config:
 * - shows the exact redirect_uri we will send to Canva
 * - confirms env vars are present
 * - lists what to check on Canva's side
 */
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireSuperAdmin();

  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const redirectUri = process.env.CANVA_REDIRECT_URI;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const enabled = process.env.ENABLE_CANVA_API === 'true';

  const computedRedirectUri = redirectUri ?? `${appUrl ?? 'http://localhost:3000'}/api/canva/callback`;

  // Test the token endpoint with a dummy code — Canva should respond with
  // "invalid_grant" (not "invalid_client" or "invalid_request"), proving
  // our client credentials are accepted even if the code is bogus.
  let credentialsValid: 'unknown' | 'ok' | 'invalid' | 'unreachable' = 'unknown';
  let probeMessage: string | undefined;
  if (clientId && clientSecret) {
    try {
      const res = await fetch('https://api.canva.com/rest/v1/oauth/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'dummy_code_for_credential_test',
          redirect_uri: computedRedirectUri,
          code_verifier: 'a'.repeat(43),
        }),
      });
      const text = await res.text();
      probeMessage = `${res.status} ${text.slice(0, 200)}`;
      if (text.includes('invalid_client') || text.includes('client authentication failed')) {
        credentialsValid = 'invalid';
      } else if (text.includes('invalid_grant') || text.includes('redirect_uri') || res.status === 400) {
        // 400 with invalid_grant means credentials are OK but code/redirect are bogus (expected)
        credentialsValid = text.includes('redirect_uri_mismatch') || text.includes('redirect uri') ? 'invalid' : 'ok';
      }
    } catch (err) {
      credentialsValid = 'unreachable';
      probeMessage = (err as Error).message;
    }
  }

  return ok({
    config: {
      CANVA_CLIENT_ID_present: !!clientId,
      CANVA_CLIENT_ID_preview: clientId ? `${clientId.slice(0, 8)}…` : null,
      CANVA_CLIENT_SECRET_present: !!clientSecret,
      CANVA_REDIRECT_URI: redirectUri ?? '(non défini — fallback utilisé)',
      NEXT_PUBLIC_APP_URL: appUrl ?? null,
      ENABLE_CANVA_API: enabled,
    },
    computedRedirectUri,
    credentialsValid,
    probeMessage,
    instructions: [
      '1. Va sur https://www.canva.com/developers/integrations → ton intégration → onglet "Authentication"',
      `2. La "URL 1 Default" doit être EXACTEMENT: ${computedRedirectUri}`,
      '3. Si différent (espace, slash final, http vs https), Canva renvoie 400 invalid_request',
      '4. Vérifie aussi onglet "Scopes" → cocher: design:meta:read, design:content:read, asset:read, profile:read',
      '5. Si tu as régénéré le Client Secret, pose le nouveau dans /admin/setup/canva',
    ],
  });
});
