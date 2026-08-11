/**
 * GoogleMailService — connexion Gmail par OAuth 2.0 Google (pattern NéoBot :
 * routes start/callback avec state signé HMAC, échange de code, refresh
 * transparent) adapté aux conventions SocialFlow :
 *
 *   - pas de dépendance googleapis — appels REST directs (comme Zernio/Resend) ;
 *   - tokens AES-256-GCM chiffrés dans UserIntegration (provider GMAIL,
 *     connexion partagée d'organisation, userId null) ;
 *   - scopes `gmail.send` + `gmail.readonly` + `calendar.events` : SocialFlow
 *     peut ENVOYER les campagnes, LIRE la boîte de réception (ingestion
 *     Conversations) et gérer les événements de l'agenda (sync calendrier),
 *     mais ne peut ni supprimer de mails ni toucher au reste de l'agenda.
 *
 * Env requis : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * (redirect URI dérivée de NEXT_PUBLIC_APP_URL, surchargée par GOOGLE_REDIRECT_URI).
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { encrypt, decrypt } from '@/lib/encryption';
import { ExternalApiError } from '@/lib/errors';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
];

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new ExternalApiError('google', 'GOOGLE_CLIENT_ID manquant (env Vercel)');
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new ExternalApiError('google', 'GOOGLE_CLIENT_SECRET manquant (env Vercel)');
  return v;
}
export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return process.env.GOOGLE_REDIRECT_URI ?? `${base.replace(/\/$/, '')}/api/integrations/google/callback`;
}

/** Extrait l'email du id_token (JWT signé par Google, reçu en direct via TLS). */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

/** Objet "Subject" RFC 2047 pour les accents. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export const GoogleMailService = {
  isConfigured(): boolean {
    return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  },

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params}`;
  },

  async exchangeCodeAndSave(organizationId: string, code: string): Promise<{ email: string | null }> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string; refresh_token?: string; expires_in?: number;
      scope?: string; id_token?: string; error_description?: string; error?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new ExternalApiError('google', `Google ${res.status}: ${json.error_description ?? json.error ?? 'échange de code refusé'}`);
    }
    const email = emailFromIdToken(json.id_token);
    const expiresAt = json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null;

    const existing = await db.userIntegration.findFirst({
      where: { organizationId, provider: 'GMAIL', userId: null },
    });
    const data = {
      accessTokenEnc: encrypt(json.access_token),
      // Google ne renvoie le refresh_token qu'au premier consent — on garde l'ancien sinon.
      ...(json.refresh_token ? { refreshTokenEnc: encrypt(json.refresh_token) } : {}),
      scope: json.scope ?? GMAIL_SCOPES.join(' '),
      expiresAt,
      displayName: email ?? 'Gmail',
      externalUserId: email,
      active: true,
    };
    if (existing) {
      await db.userIntegration.update({ where: { id: existing.id }, data });
    } else {
      await db.userIntegration.create({
        data: { organizationId, userId: null, provider: 'GMAIL', ...data },
      });
    }
    logger.info('Gmail connecté', { organizationId, email });
    return { email };
  },

  async status(organizationId: string): Promise<{ connected: boolean; email: string | null; configured: boolean }> {
    const row = await db.userIntegration.findFirst({
      where: { organizationId, provider: 'GMAIL', active: true },
      select: { externalUserId: true, displayName: true },
    });
    return {
      configured: this.isConfigured(),
      connected: !!row,
      email: row?.externalUserId ?? row?.displayName ?? null,
    };
  },

  async disconnect(organizationId: string): Promise<void> {
    await db.userIntegration.updateMany({
      where: { organizationId, provider: 'GMAIL' },
      data: { active: false },
    });
  },

  /** Access token valide — refresh transparent si expiré (marge 60 s). */
  async getAccessToken(organizationId: string): Promise<string | null> {
    const row = await db.userIntegration.findFirst({
      where: { organizationId, provider: 'GMAIL', active: true },
    });
    if (!row) return null;

    if (row.expiresAt && row.expiresAt.getTime() > Date.now() + 60_000) {
      try { return decrypt(row.accessTokenEnc); } catch { return null; }
    }
    if (!row.refreshTokenEnc) {
      try { return decrypt(row.accessTokenEnc); } catch { return null; }
    }
    let refreshToken: string;
    try { refreshToken = decrypt(row.refreshTokenEnc); } catch { return null; }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string; expires_in?: number; error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      logger.warn('Refresh du token Gmail en échec', {
        organizationId, status: res.status, error: json.error_description,
      });
      return null;
    }
    await db.userIntegration.update({
      where: { id: row.id },
      data: {
        accessTokenEnc: encrypt(json.access_token),
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      },
    });
    return json.access_token;
  },

  /**
   * Envoie un email HTML depuis le compte Gmail connecté de l'organisation.
   * `threadId` (optionnel) garde la réponse dans le fil Gmail d'origine —
   * utilisé par les réponses Conversations sur une interaction `gateway: 'gmail'`.
   */
  async sendEmail(
    organizationId: string,
    args: { to: string; subject: string; html: string; threadId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const token = await this.getAccessToken(organizationId);
    if (!token) return { ok: false, error: 'Gmail non connecté ou token invalide — reconnectez le compte.' };

    const raw = [
      `To: ${args.to}`,
      `Subject: ${encodeHeader(args.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      args.html,
    ].join('\r\n');

    try {
      const res = await fetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw: Buffer.from(raw, 'utf8').toString('base64url'),
          ...(args.threadId ? { threadId: args.threadId } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        return { ok: false, error: `Gmail ${res.status}: ${json.error?.message ?? 'erreur inconnue'}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
};
