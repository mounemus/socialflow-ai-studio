/**
 * CanvaConnectService — full OAuth flow + real API calls for Canva Connect.
 *
 * Setup steps for the SUPER_ADMIN (one time):
 *   1. Register a Canva app at https://www.canva.com/developers/integrations
 *   2. Configure redirect URI: <APP_URL>/api/canva/callback
 *   3. Note Client ID + Client Secret
 *   4. Add them via /admin/api-keys: CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, ENABLE_CANVA_API=true
 *
 * Then any user clicks "Connect Canva" on /admin/connections → standard OAuth.
 *
 * Docs: https://www.canva.dev/docs/connect/api-reference/
 *
 * Common Canva Connect scopes:
 *   - design:meta:read        — list designs
 *   - design:content:read     — read design exports
 *   - design:content:write    — modify designs (requires app review)
 *   - asset:read              — read brand assets
 *   - asset:write             — upload assets
 *   - brand_template:meta:read — list brand templates (enterprise)
 *   - profile:read            — basic user profile
 */
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/encryption';
import { ExternalApiError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const CANVA_OAUTH_AUTHORIZE = 'https://www.canva.com/api/oauth/authorize';
const CANVA_OAUTH_TOKEN = 'https://api.canva.com/rest/v1/oauth/token';
const CANVA_API = 'https://api.canva.com/rest/v1';

const DEFAULT_SCOPES = ['design:meta:read', 'design:content:read', 'asset:read', 'profile:read'];

export interface CanvaTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

function getConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const redirectUri = process.env.CANVA_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/canva/callback`;
  if (!clientId || !clientSecret) throw new ExternalApiError('canva', 'CANVA_CLIENT_ID/CANVA_CLIENT_SECRET manquant');
  return { clientId, clientSecret, redirectUri };
}

export const CanvaConnectService = {
  isConfigured(): boolean {
    return !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET && process.env.ENABLE_CANVA_API === 'true';
  },

  // === OAuth ===

  /**
   * Build the user-facing OAuth authorize URL with PKCE.
   * Caller MUST store codeVerifier server-side (in session or temp store) keyed by state.
   */
  buildAuthorizeUrl(state: string, codeChallenge: string, scopes: string[] = DEFAULT_SCOPES): string {
    const { clientId, redirectUri } = getConfig();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${CANVA_OAUTH_AUTHORIZE}?${params.toString()}`;
  },

  generatePkce(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  },

  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CanvaTokens> {
    const { clientId, clientSecret, redirectUri } = getConfig();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const res = await fetch(CANVA_OAUTH_TOKEN, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('canva', `OAuth exchange: ${res.status} ${txt}`);
    }
    return res.json();
  },

  async refreshTokens(refreshToken: string): Promise<CanvaTokens> {
    const { clientId, clientSecret } = getConfig();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(CANVA_OAUTH_TOKEN, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
    });
    if (!res.ok) throw new ExternalApiError('canva', 'Token refresh failed');
    return res.json();
  },

  /**
   * Persist tokens for an organization (org-shared connection).
   * Tokens are encrypted before storage.
   */
  async saveConnection(params: {
    organizationId: string;
    userId?: string;
    tokens: CanvaTokens;
    externalUserId?: string;
    displayName?: string;
  }) {
    const expiresAt = params.tokens.expires_in
      ? new Date(Date.now() + params.tokens.expires_in * 1000)
      : null;
    const accessTokenEnc = encrypt(params.tokens.access_token);
    const refreshTokenEnc = params.tokens.refresh_token ? encrypt(params.tokens.refresh_token) : null;
    const data = {
      accessTokenEnc,
      refreshTokenEnc,
      scope: params.tokens.scope ?? null,
      expiresAt,
      displayName: params.displayName ?? null,
      externalUserId: params.externalUserId ?? null,
      active: true,
    };
    const existing = await db.userIntegration.findFirst({
      where: { organizationId: params.organizationId, provider: 'CANVA', userId: params.userId ?? null },
    });
    if (existing) {
      return db.userIntegration.update({ where: { id: existing.id }, data });
    }
    return db.userIntegration.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        provider: 'CANVA',
        ...data,
      },
    });
  },

  async getValidAccessToken(organizationId: string): Promise<string | null> {
    const integration = await db.userIntegration.findFirst({
      where: { organizationId, provider: 'CANVA', active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!integration) return null;

    // Refresh if expired
    if (integration.expiresAt && integration.expiresAt < new Date(Date.now() + 60_000) && integration.refreshTokenEnc) {
      try {
        const tokens = await this.refreshTokens(decrypt(integration.refreshTokenEnc));
        await this.saveConnection({
          organizationId,
          userId: integration.userId ?? undefined,
          tokens,
        });
        return tokens.access_token;
      } catch (err) {
        logger.error('Canva token refresh failed', { err: (err as Error).message });
        return null;
      }
    }

    return decrypt(integration.accessTokenEnc);
  },

  // === Real API calls ===

  async apiFetch<T>(organizationId: string, path: string, init?: RequestInit): Promise<T> {
    const token = await this.getValidAccessToken(organizationId);
    if (!token) throw new ExternalApiError('canva', 'Pas de connexion Canva active pour cette org');
    const res = await fetch(`${CANVA_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('canva', `${res.status} ${txt}`);
    }
    return res.json();
  },

  async listDesigns(organizationId: string, limit = 50): Promise<{ id: string; title?: string; urls?: { edit_url?: string; view_url?: string }; thumbnail?: { url?: string }; created_at?: number; updated_at?: number }[]> {
    const data = await this.apiFetch<{ items: unknown[] }>(organizationId, `/designs?limit=${limit}`);
    return data.items as never;
  },

  async getCurrentUser(organizationId: string): Promise<{ user: { id: string; display_name?: string } }> {
    return this.apiFetch(organizationId, '/users/me');
  },

  async exportDesign(organizationId: string, designId: string, format: 'png' | 'jpg' | 'pdf' = 'png') {
    // Canva exports are async — kicks off a job then polls.
    const job = await this.apiFetch<{ job: { id: string; status: string } }>(organizationId, `/exports`, {
      method: 'POST',
      body: JSON.stringify({ design_id: designId, format: { type: format } }),
    });
    return job;
  },

  async disconnect(organizationId: string) {
    await db.userIntegration.updateMany({
      where: { organizationId, provider: 'CANVA' },
      data: { active: false },
    });
  },
};
